import type { SavedTabs } from '@shared/ipc'

export type TabEntry =
  | { kind: 'page'; pageId: string; scroll: number }
  /** A Trash entry; `pageId` is the deleted page the tab was showing, if any. */
  | { kind: 'trash'; entry: string; title: string; icon?: string; pageId?: string; scroll: number }

export interface Tab {
  id: string
  entries: TabEntry[]
  index: number
}

/** Tabs closed together, with the positions they had, so they reopen together. */
export type ClosedBatch = { tab: Tab; position: number }[]

export interface TabsState {
  tabs: Tab[]
  activeId: string
  /** Background tabs opened from `from` line up after `after`, until the active tab changes. */
  opener: { from: string; after: string } | null
  /** Newest last. */
  closed: ClosedBatch[]
}

export type TabTarget = 'current' | 'background' | 'foreground'

export const HISTORY_LIMIT = 50
export const CLOSED_LIMIT = 20

const newId = (): string => crypto.randomUUID()

export function pageEntry(pageId: string): TabEntry {
  return { kind: 'page', pageId, scroll: 0 }
}

export function currentEntry(tab: Tab): TabEntry {
  return tab.entries[tab.index]
}

export function activeTab(state: TabsState): Tab {
  return state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0]
}

/** The page a tab shows, or null while it shows a Trash entry. */
export function tabPageId(tab: Tab): string | null {
  const entry = currentEntry(tab)
  return entry.kind === 'page' ? entry.pageId : null
}

export function initialTabs(pageId: string): TabsState {
  const tab = { id: newId(), entries: [pageEntry(pageId)], index: 0 }
  return { tabs: [tab], activeId: tab.id, opener: null, closed: [] }
}

function updateTab(state: TabsState, id: string, fn: (tab: Tab) => Tab): TabsState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? fn(t) : t)) }
}

function insertAt(tabs: Tab[], index: number, tab: Tab): Tab[] {
  return [...tabs.slice(0, index), tab, ...tabs.slice(index)]
}

export function activate(state: TabsState, id: string): TabsState {
  if (state.activeId === id || !state.tabs.some((t) => t.id === id)) return state
  return { ...state, activeId: id, opener: null }
}

/** Opens a page in a new tab, placed by Chrome's rule for tabs opened from the active one. */
export function openInTab(
  state: TabsState,
  entries: TabEntry[],
  index: number,
  target: 'background' | 'foreground' | 'next'
): TabsState {
  const tab: Tab = { id: newId(), entries, index }
  const activeIndex = state.tabs.findIndex((t) => t.id === state.activeId)
  let at = activeIndex + 1
  if (target !== 'next' && state.opener?.from === state.activeId) {
    const after = state.tabs.findIndex((t) => t.id === state.opener!.after)
    if (after !== -1) at = after + 1
  }
  const tabs = insertAt(state.tabs, at, tab)
  if (target === 'background') {
    return { ...state, tabs, opener: { from: state.activeId, after: tab.id } }
  }
  return { ...state, tabs, activeId: tab.id, opener: null }
}

/** Copies a tab, history and all, right after it, and activates the copy. */
export function duplicate(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index === -1) return state
  const source = state.tabs[index]
  const tab: Tab = { id: newId(), entries: source.entries, index: source.index }
  return { ...state, tabs: insertAt(state.tabs, index + 1, tab), activeId: tab.id, opener: null }
}

/**
 * Closes tabs as one batch. A closed active tab hands over to its right neighbour, or its left one.
 * Closing every tab is the caller's to handle: the window closes instead.
 */
export function closeTabs(state: TabsState, ids: string[], keepActive?: string): TabsState {
  const closing = new Set(ids)
  const batch: ClosedBatch = state.tabs.flatMap((tab, position) =>
    closing.has(tab.id) ? [{ tab, position }] : []
  )
  const tabs = state.tabs.filter((t) => !closing.has(t.id))
  if (batch.length === 0 || tabs.length === 0) return state
  let activeId = keepActive ?? state.activeId
  if (closing.has(activeId)) {
    const from = state.tabs.findIndex((t) => t.id === activeId)
    const right = state.tabs.slice(from + 1).find((t) => !closing.has(t.id))
    const left = state.tabs
      .slice(0, from)
      .reverse()
      .find((t) => !closing.has(t.id))
    activeId = (right ?? left)!.id
  }
  return {
    tabs,
    activeId,
    opener: activeId === state.activeId ? state.opener : null,
    closed: [...state.closed, batch].slice(-CLOSED_LIMIT)
  }
}

export function closeOthers(state: TabsState, id: string): TabsState {
  return closeTabs(
    state,
    state.tabs.filter((t) => t.id !== id).map((t) => t.id),
    id
  )
}

export function closeSide(state: TabsState, id: string, side: 'left' | 'right'): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id)
  const ids = (side === 'left' ? state.tabs.slice(0, index) : state.tabs.slice(index + 1)).map(
    (t) => t.id
  )
  const keep = ids.includes(state.activeId) ? id : state.activeId
  return closeTabs(state, ids, keep)
}

/** Puts the last closed batch back where it was, and activates its first tab. */
export function reopen(state: TabsState): TabsState {
  const batch = state.closed[state.closed.length - 1]
  if (!batch) return state
  let tabs = state.tabs
  for (const { tab, position } of batch) tabs = insertAt(tabs, Math.min(position, tabs.length), tab)
  return { tabs, activeId: batch[0].tab.id, opener: null, closed: state.closed.slice(0, -1) }
}

export function moveTab(state: TabsState, id: string, to: number): TabsState {
  const from = state.tabs.findIndex((t) => t.id === id)
  if (from === -1) return state
  const rest = state.tabs.filter((t) => t.id !== id)
  const index = Math.max(0, Math.min(to, rest.length))
  if (index === from) return state
  return { ...state, tabs: insertAt(rest, index, state.tabs[from]) }
}

/** The next or previous tab, wrapping around. */
export function step(state: TabsState, delta: 1 | -1): TabsState {
  const n = state.tabs.length
  const index = state.tabs.findIndex((t) => t.id === state.activeId)
  return activate(state, state.tabs[(index + delta + n) % n].id)
}

/** Cmd+1 to Cmd+8 pick that tab if it exists; Cmd+9 picks the last one. */
export function selectNumber(state: TabsState, n: number): TabsState {
  const tab = n === 9 ? state.tabs[state.tabs.length - 1] : state.tabs[n - 1]
  return tab ? activate(state, tab.id) : state
}

/** Records the scroll position of a tab's current entry. */
export function setScroll(state: TabsState, id: string, scroll: number): TabsState {
  return updateTab(state, id, (tab) => ({
    ...tab,
    entries: tab.entries.map((e, i) => (i === tab.index ? { ...e, scroll } : e))
  }))
}

/** Drops the entries after the current one and appends `entry`, keeping at most HISTORY_LIMIT. */
export function navigate(state: TabsState, id: string, entry: TabEntry): TabsState {
  return updateTab(state, id, (tab) => {
    const entries = [...tab.entries.slice(0, tab.index + 1), entry].slice(-HISTORY_LIMIT)
    return { ...tab, entries, index: entries.length - 1 }
  })
}

/** Replaces the current entry, as when a Trash entry is restored to its page. */
export function replaceCurrent(state: TabsState, id: string, entry: TabEntry): TabsState {
  return updateTab(state, id, (tab) => ({
    ...tab,
    entries: tab.entries.map((e, i) => (i === tab.index ? entry : e))
  }))
}

/** The nearest entry in that direction that `usable` accepts, or null. */
export function nearest(tab: Tab, delta: 1 | -1, usable: (e: TabEntry) => boolean): number | null {
  for (let i = tab.index + delta; i >= 0 && i < tab.entries.length; i += delta) {
    if (usable(tab.entries[i])) return i
  }
  return null
}

export function goTo(state: TabsState, id: string, index: number): TabsState {
  return updateTab(state, id, (tab) => ({ ...tab, index }))
}

/** What is saved for a workspace: pages, including deleted ones, but not Trash entries opened as such. */
export function serialize(state: TabsState): SavedTabs {
  const tabs: SavedTabs['tabs'] = []
  let active = 0
  for (const tab of state.tabs) {
    const history: string[] = []
    let index = 0
    tab.entries.forEach((e, i) => {
      if (!e.pageId) return
      if (i <= tab.index) index = history.length
      history.push(e.pageId)
    })
    if (history.length === 0) continue
    if (tab.id === state.activeId) active = tabs.length
    tabs.push({ history, index })
  }
  return { tabs, active }
}

/** Rebuilds saved tabs, keeping only pages `keep` accepts; null when no tab survives. */
export function restore(saved: SavedTabs, keep: (pageId: string) => boolean): TabsState | null {
  const tabs: Tab[] = []
  let activeId: string | null = null
  saved.tabs.forEach((s, i) => {
    const entries: TabEntry[] = []
    let index = 0
    s.history.forEach((pageId, j) => {
      if (!keep(pageId)) return
      if (j <= s.index) index = entries.length
      entries.push(pageEntry(pageId))
    })
    if (entries.length === 0) return
    const tab = { id: newId(), entries, index }
    tabs.push(tab)
    if (i <= saved.active || activeId === null) activeId = tab.id
  })
  if (tabs.length === 0 || activeId === null) return null
  return { tabs, activeId, opener: null, closed: [] }
}
