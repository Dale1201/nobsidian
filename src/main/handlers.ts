import { BrowserWindow, dialog, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { TreeSnapshot } from '../shared/ipc'
import type { WorkspaceInfo } from '../shared/types'
import { handle, send } from './ipc'
import type { SettingsStore } from './settings'
import { Workspace } from './workspace/workspace'

export interface AppContext {
  settings: SettingsStore
  workspace: Workspace | null
  window: () => BrowserWindow | null
}

export function workspaceInfo(ws: Workspace): WorkspaceInfo {
  return { root: ws.root, name: basename(ws.root) }
}

export function snapshot(ws: Workspace): TreeSnapshot {
  return { pages: ws.tree(), favorites: ws.favorites() }
}

export async function openWorkspace(ctx: AppContext, root: string): Promise<WorkspaceInfo> {
  ctx.workspace = await Workspace.open(root)
  await ctx.settings.set({ lastWorkspace: root })
  return workspaceInfo(ctx.workspace)
}

export function registerHandlers(ctx: AppContext): void {
  const ws = (): Workspace => {
    if (!ctx.workspace) throw new Error('No workspace is open')
    return ctx.workspace
  }
  const changed = (): void => {
    const win = ctx.window()
    if (win && ctx.workspace) send(win.webContents, 'tree:changed', snapshot(ctx.workspace))
  }
  const mutate =
    <P>(fn: (w: Workspace, p: P) => Promise<void>) =>
    async (p: P): Promise<void> => {
      await fn(ws(), p)
      changed()
    }

  handle('workspace:current', () => (ctx.workspace ? workspaceInfo(ctx.workspace) : null))
  handle('workspace:choose', async () => {
    const win = ctx.window()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a folder for your notes',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return openWorkspace(ctx, result.filePaths[0])
  })
  handle('tree:get', () => snapshot(ws()))
  handle('page:read', ({ id }) => ws().readPage(id))
  handle('page:write', async ({ id, blocks }) => {
    await ws().writePage(id, blocks)
  })
  handle(
    'page:meta',
    mutate((w, { id, patch }) => w.updateMeta(id, patch))
  )
  handle('page:create', async ({ parentId, index }) => {
    const node = await ws().createPage(parentId, index)
    changed()
    return node
  })
  handle(
    'page:rename',
    mutate((w, { id, title }) => w.renamePage(id, title))
  )
  handle(
    'page:move',
    mutate((w, { id, parentId, index }) => w.movePage(id, parentId, index))
  )
  handle(
    'page:trash',
    mutate((w, { id }) => w.trashPage(id))
  )
  handle(
    'page:favorite',
    mutate((w, { id, favorite }) => w.setFavorite(id, favorite))
  )
  handle('attachment:save', ({ name, data }) => ws().saveAttachment(name, data))
  handle('attachment:chooseImage', async () => {
    const win = ctx.window()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const file = result.filePaths[0]
    return ws().saveAttachment(basename(file), new Uint8Array(await readFile(file)))
  })
  handle('attachment:open', async ({ href }) => {
    const file = ws().resolveAsset(href)
    if (file) await shell.openPath(file)
  })
  handle('settings:get', () => ctx.settings.get())
  handle('settings:set', (patch) => ctx.settings.set(patch))
  handle('shell:openExternal', async ({ url }) => {
    if (/^(https?|mailto):/i.test(url)) await shell.openExternal(url)
  })
}
