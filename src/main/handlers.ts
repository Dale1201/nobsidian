import { BrowserWindow, dialog, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { TreeSnapshot } from '../shared/ipc'
import type { WorkspaceInfo } from '../shared/types'
import { handle, send } from './ipc'
import type { SettingsStore } from './settings'
import { exists } from './workspace/fs-utils'
import { watchWorkspace, type WorkspaceWatcher } from './workspace/watcher'
import { Workspace } from './workspace/workspace'

export interface AppContext {
  settings: SettingsStore
  workspace: Workspace | null
  watcher: WorkspaceWatcher | null
  maintainTimer: ReturnType<typeof setTimeout> | null
  window: () => BrowserWindow | null
}

export function workspaceInfo(ws: Workspace): WorkspaceInfo {
  return { root: ws.root, name: basename(ws.root) }
}

export function snapshot(ws: Workspace): TreeSnapshot {
  return { pages: ws.tree(), favorites: ws.favorites() }
}

export async function openWorkspace(ctx: AppContext, root: string): Promise<WorkspaceInfo> {
  const ws = await Workspace.open(root)
  await closeWorkspace(ctx)
  ctx.workspace = ws
  await ctx.settings.set({ lastWorkspace: root })
  ws.onEvent((event) => {
    const win = ctx.window()
    if (!win || ctx.workspace !== ws) return
    if (event.type === 'tree') send(win.webContents, 'tree:changed', snapshot(ws))
    else send(win.webContents, 'page:changed', { id: event.id, revision: event.revision })
  })
  const lost = async (): Promise<void> => {
    if (ctx.workspace !== ws || (await exists(root))) return
    if (ctx.workspace !== ws) return
    await closeWorkspace(ctx, { checkpoint: false })
    const win = ctx.window()
    if (win) send(win.webContents, 'workspace:missing', undefined)
  }
  ctx.watcher = watchWorkspace(
    root,
    (changes) => {
      if (changes.some((c) => c.kind === 'unlinkDir' && c.path === '')) void lost()
      else void ws.reconcile(changes).catch((err) => console.error('Reconcile failed', err))
    },
    () => void lost()
  )
  void ws.indexContent().catch((err) => console.error('Indexing failed', err))
  // Housekeeping can wait until the window is up.
  ctx.maintainTimer = setTimeout(() => {
    void ws.maintain().catch((err) => console.error('Workspace maintenance failed', err))
  }, 1000)
  return workspaceInfo(ws)
}

export async function closeWorkspace(
  ctx: AppContext,
  { checkpoint = true }: { checkpoint?: boolean } = {}
): Promise<void> {
  const { watcher, workspace } = ctx
  if (ctx.maintainTimer) clearTimeout(ctx.maintainTimer)
  ctx.maintainTimer = null
  ctx.watcher = null
  ctx.workspace = null
  await watcher?.close()
  if (checkpoint) await workspace?.checkpoint().catch(() => {})
  workspace?.close()
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
    <P, R>(fn: (w: Workspace, p: P) => Promise<R>) =>
    async (p: P): Promise<R> => {
      const result = await fn(ws(), p)
      changed()
      return result
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
  handle('page:write', ({ id, blocks, revision, force }) =>
    ws().writePage(id, blocks, { revision, force })
  )
  handle(
    'page:meta',
    mutate((w, { id, patch }) => w.updateMeta(id, patch))
  )
  handle(
    'page:create',
    mutate((w, { parentId, index }) => w.createPage(parentId, index))
  )
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
    'page:duplicate',
    mutate((w, { id }) => w.duplicatePage(id))
  )
  handle(
    'page:favorite',
    mutate((w, { id, favorite }) => w.setFavorite(id, favorite))
  )
  handle('search:query', ({ query }) => ws().search(query))
  handle('trash:list', () => ws().listTrash())
  handle('trash:read', ({ entry }) => ws().readTrash(entry))
  handle(
    'trash:restore',
    mutate((w, { entry }) => w.restoreTrash(entry))
  )
  handle('trash:delete', ({ entry }) => ws().deleteTrash(entry))
  handle('history:list', ({ id }) => ws().listHistory(id))
  handle('history:read', ({ id, version }) => ws().readHistory(id, version))
  handle(
    'history:restore',
    mutate((w, { id, version }) => w.restoreHistory(id, version))
  )
  handle('history:checkpoint', ({ id }) => ws().checkpoint(id))
  handle('history:draft', ({ id, blocks }) => ws().keepDraft(id, blocks))
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
