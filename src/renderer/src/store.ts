import type { DrawingSession } from './drawing/session'
import { create } from 'zustand'
import type { Block } from '@shared/core/blocks'
import { RECENT_LIMIT, type Settings, type TreeSnapshot } from '@shared/ipc'
import type { ImportStatus, PageNode, WorkspaceInfo } from '@shared/types'
import { findNode, firstPageId, pathTo } from './lib/tree'

const api = window.api

// Editors register a flush so pending autosaves land before destructive actions and quit.
// A flush resolves false when edits are still unsaved afterwards.
const flushers = new Set<() => Promise<boolean>>()
// Run before the others, for work that ends in an edit the page editors must still save.
const firstFlushers = new Set<() => Promise<boolean>>()
export function registerFlusher(
  fn: () => Promise<boolean>,
  options?: { first?: boolean }
): () => void {
  const set = options?.first ? firstFlushers : flushers
  set.add(fn)
  return () => set.delete(fn)
}
export async function flushAll(): Promise<boolean> {
  const first = await Promise.all([...firstFlushers].map((fn) => fn()))
  return [...first, ...(await Promise.all([...flushers].map((fn) => fn())))].every(Boolean)
}

let errorTimer: ReturnType<typeof setTimeout> | undefined
function showError(message: string): void {
  clearTimeout(errorTimer)
  useApp.setState({ error: message })
  errorTimer = setTimeout(() => useApp.setState({ error: null }), 6000)
}

/** Edits an editor could not save when it closed, with the state it held them in. */
export interface Rescue {
  blocks: Block[]
  revision: number
  conflicted: boolean
}

export type Overlay =
  | { kind: 'search' }
  | { kind: 'move'; pageId: string }
  | { kind: 'history'; pageId: string }
  | { kind: 'drawing'; session: DrawingSession }

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
  /** Open confirm dialogs; while any is open, nothing else opens over it. */
  confirms: number
  /** Rescued edits by page id, waiting for that page's editor to show them again. */
  rescued: Record<string, Rescue>
  /** The Notion import shown in the progress panel; null once dismissed. */
  importStatus: ImportStatus | null

  init: () => Promise<void>
  chooseWorkspace: () => Promise<void>
  applySnapshot: (snapshot: TreeSnapshot) => void
  /** `scroll: false` when the page was picked in the sidebar, which is already showing it. */
  openPage: (id: string, options?: { scroll?: boolean }) => void
  back: () => void
  forward: () => void
  createPage: (
    parentId: string | null,
    index?: number,
    options?: { expandKey?: string; scroll?: boolean }
  ) => Promise<string>
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
  revealInSidebar: (id: string) => Promise<void>
  /** The page whose sidebar row should scroll into view once it shows, or null. */
  revealRequest: string | null
  takeReveal: (id: string) => void
  setRenaming: (id: string | null) => void
  reportError: (action: string, err: unknown) => Promise<void>
  rescue: (id: string, rescue: Rescue) => Promise<void>
  takeRescued: (id: string) => void
  showMessage: (message: string) => void
  /** Imports these zips, or asks which ones when none are given. */
  startImport: (paths?: string[]) => Promise<void>
  cancelImport: () => Promise<void>
  setImportStatus: (status: ImportStatus | null) => void
}

export function errorReason(err: unknown): string {
  return err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
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
  revealRequest: null,
  renamingId: null,
  error: null,
  overlay: null,
  trashEntry: null,
  confirms: 0,
  rescued: {},
  importStatus: null,

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
    if (!(await flushAll())) return
    let workspace: WorkspaceInfo | null
    try {
      workspace = await api.invoke('workspace:choose', undefined)
    } catch (e) {
      showError(`Couldn't open that folder: ${errorReason(e)}`)
      return
    }
    if (!workspace) return
    set({
      workspace,
      currentId: null,
      history: [],
      historyIndex: -1,
      overlay: null,
      trashEntry: null,
      importStatus: null
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

  openPage: (id, options) => {
    const { history, historyIndex, currentId, workspace, settings, trashEntry } = get()
    if (trashEntry) set({ trashEntry: null })
    // The page is already open, but a search or link to it still shows it in the sidebar.
    if (id === currentId) {
      if (options?.scroll !== false) set({ revealRequest: id })
      void get().revealInSidebar(id)
      return
    }
    const nextHistory = [...history.slice(0, historyIndex + 1), id]
    set({
      currentId: id,
      history: nextHistory,
      historyIndex: nextHistory.length - 1,
      revealRequest: options?.scroll === false ? null : id
    })
    void get().revealInSidebar(id)
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
      if (findNode(tree, history[i])) {
        set({ currentId: history[i], historyIndex: i, trashEntry: null, revealRequest: history[i] })
        void get().revealInSidebar(history[i])
        return
      }
    }
  },

  forward: () => {
    const { history, historyIndex, tree } = get()
    for (let i = historyIndex + 1; i < history.length; i++) {
      if (findNode(tree, history[i])) {
        set({ currentId: history[i], historyIndex: i, trashEntry: null, revealRequest: history[i] })
        void get().revealInSidebar(history[i])
        return
      }
    }
  },

  createPage: async (parentId, index, options) => {
    const node = await api.invoke('page:create', { parentId, index })
    if (parentId) await get().setExpanded(options?.expandKey ?? parentId, true)
    get().openPage(node.id, { scroll: options?.scroll })
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
    if (!(await flushAll())) return
    await api.invoke('page:trash', { id }).catch((e) => get().reportError('delete', e))
  },

  duplicatePage: async (id) => {
    if (!(await flushAll())) return
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
    set({
      workspace: null,
      currentId: null,
      trashEntry: null,
      overlay: null,
      tree: [],
      favorites: [],
      importStatus: null
    }),

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

  takeReveal: (id) => {
    if (get().revealRequest === id) set({ revealRequest: null })
  },

  revealInSidebar: async (id) => {
    const { settings, workspace, tree } = get()
    if (!settings || !workspace) return
    const current = settings.expanded[workspace.root] ?? []
    const missing = pathTo(tree, id)
      .slice(0, -1)
      .map((n) => n.id)
      .filter((a) => !current.includes(a))
    if (missing.length === 0) return
    await get().updateSettings({
      expanded: { ...settings.expanded, [workspace.root]: [...current, ...missing] }
    })
  },

  setRenaming: (id) => set({ renamingId: id }),

  showMessage: (message) => showError(message),

  startImport: async (paths) => {
    try {
      if (paths) await api.invoke('import:start', { paths })
      else await api.invoke('import:choose', undefined)
    } catch (e) {
      showError(errorReason(e))
    }
  },

  cancelImport: async () => {
    await api.invoke('import:cancel', undefined).catch(() => {})
  },

  setImportStatus: (importStatus) => set({ importStatus }),

  /** Shows what failed and re-syncs the sidebar with what is actually on disk. */
  reportError: async (action, err) => {
    showError(`Couldn't ${action} the page: ${errorReason(err)}`)
    const snapshot = await api.invoke('tree:get', undefined).catch(() => null)
    if (snapshot) get().applySnapshot(snapshot)
  },

  /** Opens the page again with the edits, or a new page with them if it was deleted. */
  rescue: async (id, rescue) => {
    if (findNode(get().tree, id)) {
      set({ rescued: { ...get().rescued, [id]: rescue } })
      return get().openPage(id)
    }
    // With the notes folder gone, creating a page would bring back an empty copy of it.
    if (!get().workspace) return
    try {
      const node = await api.invoke('page:create', {
        parentId: null,
        title: 'Recovered edits',
        blocks: rescue.blocks
      })
      get().openPage(node.id)
    } catch (e) {
      await get().reportError('recover', e)
    }
  },

  takeRescued: (id) => {
    const rescued = { ...get().rescued }
    delete rescued[id]
    set({ rescued })
  }
}))
