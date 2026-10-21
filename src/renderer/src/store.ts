import { create } from 'zustand'
import type { Settings, TreeSnapshot } from '@shared/ipc'
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
  toggleFavorite: (id: string) => Promise<void>
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  setExpanded: (id: string, open: boolean) => Promise<void>
  setRenaming: (id: string | null) => void
  reportError: (action: string, err: unknown) => Promise<void>
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
    const workspace = await api.invoke('workspace:choose', undefined)
    if (!workspace) return
    set({ workspace, currentId: null, history: [], historyIndex: -1 })
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
    const { history, historyIndex, currentId, workspace, settings } = get()
    if (id === currentId) return
    const nextHistory = [...history.slice(0, historyIndex + 1), id]
    set({ currentId: id, history: nextHistory, historyIndex: nextHistory.length - 1 })
    if (workspace && settings) {
      void get().updateSettings({ lastPage: { ...settings.lastPage, [workspace.root]: id } })
    }
  },

  back: () => {
    const { history, historyIndex, tree } = get()
    for (let i = historyIndex - 1; i >= 0; i--) {
      if (findNode(tree, history[i])) return set({ currentId: history[i], historyIndex: i })
    }
  },

  forward: () => {
    const { history, historyIndex, tree } = get()
    for (let i = historyIndex + 1; i < history.length; i++) {
      if (findNode(tree, history[i])) return set({ currentId: history[i], historyIndex: i })
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
    const reason =
      err instanceof Error
        ? err.message.replace(/^Error invoking remote method '[^']+': /, '')
        : String(err)
    set({ error: `Couldn't ${action} the page: ${reason}` })
    setTimeout(() => set({ error: null }), 6000)
    get().applySnapshot(await api.invoke('tree:get', undefined))
  }
}))
