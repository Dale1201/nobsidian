import { create } from 'zustand'
import { RECENT_LIMIT, type Settings, type TreeSnapshot } from '@shared/ipc'
import type { PageNode, WorkspaceInfo } from '@shared/types'
import { findNode, firstPageId } from './lib/tree'

const api = window.api

// Editors register a flush so pending autosaves land before destructive actions and quit.
const flushers = new Set<() => Promise<void>>()
export function registerFlusher(fn: () => Promise<void>): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}
export async function flushAll(): Promise<void> {
  await Promise.all([...flushers].map((fn) => fn()))
}

export type Overlay =
  { kind: 'search' } | { kind: 'move'; pageId: string } | { kind: 'history'; pageId: string }

interface AppState {
  ready: boolean
  workspace: WorkspaceInfo | null
  tree: PageNode[]
  favorites: string[]
  settings: Settings | null
  currentId: string | null
  history: string[]
  historyIndex: number
  renamingId: string | null
  error: string | null
  overlay: Overlay | null
  /** Trash entry whose page is shown read-only instead of the current page. */
  trashEntry: string | null

  init: () => Promise<void>
  chooseWorkspace: () => Promise<void>
  applySnapshot: (snapshot: TreeSnapshot) => void
  openPage: (id: string) => void
  back: () => void
  forward: () => void
  createPage: (parentId: string | null, index?: number) => Promise<string>
  renamePage: (id: string, title: string) => Promise<void>
  movePage: (id: string, parentId: string | null, index: number) => Promise<void>
  trashPage: (id: string) => Promise<void>
  duplicatePage: (id: string) => Promise<void>
  showTrashEntry: (entry: string | null) => void
  restoreTrash: (entry: string) => Promise<void>
  deleteTrash: (entry: string) => Promise<void>
  setOverlay: (overlay: Overlay | null) => void
  workspaceMissing: () => void
  toggleFavorite: (id: string) => Promise<void>
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  setExpanded: (id: string, open: boolean) => Promise<void>
  setRenaming: (id: string | null) => void
  reportError: (action: string, err: unknown) => Promise<void>
}

function errorReason(err: unknown): string {
  return err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': /, '')
    : String(err)
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  workspace: null,
  tree: [],
  favorites: [],
  settings: null,
  currentId: null,
  history: [],
  historyIndex: -1,
  renamingId: null,
  error: null,
  overlay: null,
  trashEntry: null,

  init: async () => {
    const [settings, workspace] = await Promise.all([
      api.invoke('settings:get', undefined),
      api.invoke('workspace:current', undefined)
    ])
    set({ settings, workspace })
    if (workspace) {
      get().applySnapshot(await api.invoke('tree:get', undefined))
      const last = settings.lastPage[workspace.root]
      const start = last && findNode(get().tree, last) ? last : firstPageId(get().tree)
      if (start) get().openPage(start)
    }
    set({ ready: true })
  },

  chooseWorkspace: async () => {
    // Pending edits must land in the workspace they belong to.
    await flushAll()
    let workspace: WorkspaceInfo | null
    try {
      workspace = await api.invoke('workspace:choose', undefined)
    } catch (e) {
      set({ error: `Couldn't open that folder: ${errorReason(e)}` })
      setTimeout(() => set({ error: null }), 6000)
      return
    }
    if (!workspace) return
    set({
      workspace,
      currentId: null,
      history: [],
      historyIndex: -1,
      overlay: null,
      trashEntry: null
    })
    get().applySnapshot(await api.invoke('tree:get', undefined))
    const start = firstPageId(get().tree) ?? (await get().createPage(null))
    get().openPage(start)
  },

  applySnapshot: ({ pages, favorites }) => {
    set({ tree: pages, favorites })
    const { currentId } = get()
    if (currentId && !findNode(pages, currentId)) {
      const fallback = firstPageId(pages)
      set({ currentId: null })
      if (fallback) get().openPage(fallback)
    }
  },

  openPage: (id) => {
    const { history, historyIndex, currentId, workspace, settings, trashEntry } = get()
    if (trashEntry) set({ trashEntry: null })
    if (id === currentId) return
    const nextHistory = [...history.slice(0, historyIndex + 1), id]
    set({ currentId: id, history: nextHistory, historyIndex: nextHistory.length - 1 })
    if (workspace && settings) {
      const recent = [id, ...(settings.recent[workspace.root] ?? []).filter((r) => r !== id)]
      void get().updateSettings({
        lastPage: { ...settings.lastPage, [workspace.root]: id },
        recent: { ...settings.recent, [workspace.root]: recent.slice(0, RECENT_LIMIT) }
      })
    }
  },

  back: () => {
    const { history, historyIndex, tree } = get()
    for (let i = historyIndex - 1; i >= 0; i--) {
      if (findNode(tree, history[i]))
        return set({ currentId: history[i], historyIndex: i, trashEntry: null })
    }
  },

  forward: () => {
    const { history, historyIndex, tree } = get()
    for (let i = historyIndex + 1; i < history.length; i++) {
      if (findNode(tree, history[i]))
        return set({ currentId: history[i], historyIndex: i, trashEntry: null })
    }
  },

  createPage: async (parentId, index) => {
    const node = await api.invoke('page:create', { parentId, index })
    if (parentId) await get().setExpanded(parentId, true)
    get().openPage(node.id)
    return node.id
  },

  renamePage: async (id, title) => {
    await api.invoke('page:rename', { id, title }).catch((e) => get().reportError('rename', e))
  },

  movePage: async (id, parentId, index) => {
    try {
      await api.invoke('page:move', { id, parentId, index })
      if (parentId) await get().setExpanded(parentId, true)
    } catch (e) {
      await get().reportError('move', e)
    }
  },

  trashPage: async (id) => {
    await flushAll()
    await api.invoke('page:trash', { id }).catch((e) => get().reportError('delete', e))
  },

  duplicatePage: async (id) => {
    await flushAll()
    try {
      const node = await api.invoke('page:duplicate', { id })
      get().openPage(node.id)
    } catch (e) {
      await get().reportError('duplicate', e)
    }
  },

  showTrashEntry: (entry) => set({ trashEntry: entry }),

  restoreTrash: async (entry) => {
    try {
      const id = await api.invoke('trash:restore', { entry })
      set({ trashEntry: null })
      get().openPage(id)
    } catch (e) {
      await get().reportError('restore', e)
    }
  },

  deleteTrash: async (entry) => {
    try {
      await api.invoke('trash:delete', { entry })
      if (get().trashEntry === entry) set({ trashEntry: null })
    } catch (e) {
      await get().reportError('delete', e)
    }
  },

  setOverlay: (overlay) => set({ overlay }),

  workspaceMissing: () =>
    set({ workspace: null, currentId: null, trashEntry: null, overlay: null, tree: [] }),

  toggleFavorite: async (id) => {
    await api
      .invoke('page:favorite', { id, favorite: !get().favorites.includes(id) })
      .catch((e) => get().reportError('update favorites for', e))
  },

  updateSettings: async (patch) => {
    set({ settings: await api.invoke('settings:set', patch) })
  },

  setExpanded: async (id, open) => {
    const { settings, workspace } = get()
    if (!settings || !workspace) return
    const current = new Set(settings.expanded[workspace.root] ?? [])
    if (open === current.has(id)) return
    if (open) current.add(id)
    else current.delete(id)
    await get().updateSettings({
      expanded: { ...settings.expanded, [workspace.root]: [...current] }
    })
  },

  setRenaming: (id) => set({ renamingId: id }),

  /** Shows what failed and re-syncs the sidebar with what is actually on disk. */
  reportError: async (action, err) => {
    set({ error: `Couldn't ${action} the page: ${errorReason(err)}` })
    setTimeout(() => set({ error: null }), 6000)
    get().applySnapshot(await api.invoke('tree:get', undefined))
  }
}))
