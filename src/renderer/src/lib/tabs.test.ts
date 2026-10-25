import { describe, expect, it } from 'vitest'
import {
  CLOSED_LIMIT,
  HISTORY_LIMIT,
  activate,
  activeTab,
  closeOthers,
  closeSide,
  closeTabs,
  currentEntry,
  duplicate,
  goTo,
  initialTabs,
  moveTab,
  navigate,
  nearest,
  openInTab,
  pageEntry,
  reopen,
  replaceCurrent,
  restore,
  selectNumber,
  serialize,
  setScroll,
  step,
  tabPageId,
  type TabsState
} from './tabs'

const pages = (state: TabsState): (string | null)[] => state.tabs.map(tabPageId)
const active = (state: TabsState): string | null => tabPageId(activeTab(state))
const open = (
  state: TabsState,
  pageId: string,
  target: 'background' | 'foreground' | 'next'
): TabsState => openInTab(state, [pageEntry(pageId)], 0, target)
/** Tabs a, b, c with a active. */
const three = (): TabsState => {
  let s = initialTabs('a')
  s = open(s, 'c', 'next')
  s = activate(s, s.tabs[0].id)
  return open(s, 'b', 'next')
}
const idOf = (state: TabsState, pageId: string): string =>
  state.tabs.find((t) => tabPageId(t) === pageId)!.id

describe('opening tabs', () => {
  it('opens a new tab right after the active one and switches to it', () => {
    const s = three()
    expect(pages(s)).toEqual(['a', 'b', 'c'])
    expect(active(s)).toBe('b')
  })

  it('lines background tabs up after each other, then starts over once the active tab changes', () => {
    let s = three()
    s = activate(s, idOf(s, 'a'))
    s = open(s, 'x', 'background')
    s = open(s, 'y', 'background')
    expect(pages(s)).toEqual(['a', 'x', 'y', 'b', 'c'])
    expect(active(s)).toBe('a')
    s = activate(s, idOf(s, 'b'))
    s = activate(s, idOf(s, 'a'))
    s = open(s, 'z', 'background')
    expect(pages(s)).toEqual(['a', 'z', 'x', 'y', 'b', 'c'])
  })

  it('puts a foreground tab where the next background tab would go, and switches to it', () => {
    let s = three()
    s = activate(s, idOf(s, 'a'))
    s = open(s, 'x', 'background')
    s = open(s, 'y', 'foreground')
    expect(pages(s)).toEqual(['a', 'x', 'y', 'b', 'c'])
    expect(active(s)).toBe('y')
  })

  it('duplicates a tab with its history, right after it', () => {
    let s = initialTabs('a')
    s = navigate(s, s.activeId, pageEntry('a2'))
    s = activate(s, s.tabs[0].id)
    s = duplicate(s, s.tabs[0].id)
    expect(s.tabs).toHaveLength(2)
    expect(s.tabs[1].entries.map((e) => e.kind === 'page' && e.pageId)).toEqual(['a', 'a2'])
    expect(s.tabs[1].index).toBe(1)
    expect(s.activeId).toBe(s.tabs[1].id)
  })
})

describe('closing tabs', () => {
  it('hands over to the right neighbour of a closed active tab, or the left one at the end', () => {
    let s = three()
    s = closeTabs(s, [s.activeId])
    expect(pages(s)).toEqual(['a', 'c'])
    expect(active(s)).toBe('c')
    s = closeTabs(s, [s.activeId])
    expect(active(s)).toBe('a')
  })

  it('keeps the active tab when another one closes', () => {
    const s = three()
    expect(active(closeTabs(s, [idOf(s, 'c')]))).toBe('b')
  })

  it('leaves the last tab to the caller', () => {
    const s = initialTabs('a')
    expect(closeTabs(s, [s.activeId])).toBe(s)
  })

  it('closes the other tabs and keeps the chosen one active', () => {
    const base = three()
    const s = closeOthers(base, idOf(base, 'a'))
    expect(pages(s)).toEqual(['a'])
    expect(active(s)).toBe('a')
  })

  it('closes the tabs to the left or right of a tab', () => {
    const base = three()
    const right = closeSide(base, idOf(base, 'a'), 'right')
    expect(pages(right)).toEqual(['a'])
    expect(active(right)).toBe('a')
    const left = closeSide(base, idOf(base, 'c'), 'left')
    expect(pages(left)).toEqual(['c'])
    expect(active(left)).toBe('c')
  })

  it('reopens the last closed tab where it was, and activates it', () => {
    let s = three()
    s = closeTabs(s, [idOf(s, 'b')])
    s = reopen(s)
    expect(pages(s)).toEqual(['a', 'b', 'c'])
    expect(active(s)).toBe('b')
    expect(reopen(s)).toBe(s)
  })

  it('reopens a batch of closed tabs together', () => {
    let s = three()
    s = closeOthers(s, idOf(s, 'b'))
    expect(pages(s)).toEqual(['b'])
    s = reopen(s)
    expect(pages(s)).toEqual(['a', 'b', 'c'])
  })

  it('remembers a limited number of closed batches', () => {
    let s = initialTabs('a')
    for (let i = 0; i < CLOSED_LIMIT + 5; i++) {
      s = open(s, `p${i}`, 'next')
      s = closeTabs(s, [s.activeId])
    }
    expect(s.closed).toHaveLength(CLOSED_LIMIT)
  })
})

describe('moving between tabs', () => {
  it('moves a tab to a new position', () => {
    const s = three()
    expect(pages(moveTab(s, idOf(s, 'a'), 2))).toEqual(['b', 'c', 'a'])
    expect(pages(moveTab(s, idOf(s, 'c'), 0))).toEqual(['c', 'a', 'b'])
  })

  it('steps to the next and previous tab, wrapping around', () => {
    let s = three()
    s = step(s, 1)
    expect(active(s)).toBe('c')
    s = step(s, 1)
    expect(active(s)).toBe('a')
    s = step(s, -1)
    expect(active(s)).toBe('c')
  })

  it('selects a tab by number, with 9 meaning the last one', () => {
    const s = three()
    expect(active(selectNumber(s, 1))).toBe('a')
    expect(active(selectNumber(s, 9))).toBe('c')
    expect(selectNumber(s, 5)).toBe(s)
  })
})

describe('history within a tab', () => {
  it('drops forward entries when navigating, and remembers scroll per entry', () => {
    let s = initialTabs('a')
    const id = s.activeId
    s = setScroll(s, id, 120)
    s = navigate(s, id, pageEntry('b'))
    s = navigate(s, id, pageEntry('c'))
    s = goTo(
      s,
      id,
      nearest(activeTab(s), -1, () => true)!
    )
    s = goTo(
      s,
      id,
      nearest(activeTab(s), -1, () => true)!
    )
    expect(currentEntry(activeTab(s))).toEqual({ kind: 'page', pageId: 'a', scroll: 120 })
    s = navigate(s, id, pageEntry('d'))
    expect(activeTab(s).entries.map((e) => e.kind === 'page' && e.pageId)).toEqual(['a', 'd'])
  })

  it('finds the nearest usable entry in either direction', () => {
    let s = initialTabs('a')
    for (const p of ['b', 'c', 'd']) s = navigate(s, s.activeId, pageEntry(p))
    const usable = (e: { kind: string; pageId?: string }): boolean => e.pageId !== 'c'
    expect(nearest(activeTab(s), -1, usable)).toBe(1)
    expect(nearest(activeTab(s), 1, usable)).toBeNull()
  })

  it('keeps at most HISTORY_LIMIT entries', () => {
    let s = initialTabs('p0')
    for (let i = 1; i < HISTORY_LIMIT + 10; i++) s = navigate(s, s.activeId, pageEntry(`p${i}`))
    const tab = activeTab(s)
    expect(tab.entries).toHaveLength(HISTORY_LIMIT)
    expect(tab.index).toBe(HISTORY_LIMIT - 1)
    expect(tabPageId(tab)).toBe(`p${HISTORY_LIMIT + 9}`)
  })
})

describe('saving and restoring', () => {
  it('saves page histories and the active tab, leaving out Trash entries opened as such', () => {
    let s = three()
    s = navigate(s, s.activeId, { kind: 'trash', entry: 'e1', title: 'Old', scroll: 0 })
    expect(serialize(s)).toEqual({
      tabs: [
        { history: ['a'], index: 0 },
        { history: ['b'], index: 0 },
        { history: ['c'], index: 0 }
      ],
      active: 1
    })
  })

  it('saves a deleted page shown in the trashed view as its page', () => {
    let s = initialTabs('a')
    s = replaceCurrent(s, s.activeId, {
      kind: 'trash',
      entry: 'e1',
      title: 'A',
      pageId: 'a',
      scroll: 0
    })
    expect(serialize(s)).toEqual({ tabs: [{ history: ['a'], index: 0 }], active: 0 })
  })

  it('restores tabs, dropping missing pages and tabs left empty', () => {
    const s = restore(
      {
        tabs: [
          { history: ['gone'], index: 0 },
          { history: ['a', 'gone', 'b'], index: 1 },
          { history: ['c'], index: 0 }
        ],
        active: 1
      },
      (id) => id !== 'gone'
    )!
    expect(s.tabs.map((t) => t.entries.map((e) => e.kind === 'page' && e.pageId))).toEqual([
      ['a', 'b'],
      ['c']
    ])
    expect(s.tabs[0].index).toBe(0)
    expect(s.activeId).toBe(s.tabs[0].id)
  })

  it('activates the nearest surviving tab when the active one is gone', () => {
    const s = restore(
      {
        tabs: [
          { history: ['a'], index: 0 },
          { history: ['gone'], index: 0 }
        ],
        active: 1
      },
      (id) => id !== 'gone'
    )!
    expect(s.activeId).toBe(s.tabs[0].id)
  })

  it('restores nothing when no page survives', () => {
    expect(restore({ tabs: [{ history: ['gone'], index: 0 }], active: 0 }, () => false)).toBeNull()
  })
})
