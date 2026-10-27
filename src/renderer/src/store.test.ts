import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '@shared/ipc'
import type { PageNode, TrashItem } from '@shared/types'

const node = (id: string, children: PageNode[] = []): PageNode =>
  ({ id, title: id.toUpperCase(), path: `${id}.md`, children }) as PageNode

const world = {
  tree: [] as PageNode[],
  trash: [] as TrashItem[],
  settings: {} as Settings
}
const invoke = vi.fn(async (channel: string, payload?: unknown): Promise<unknown> => {
  if (channel === 'workspace:choose') return { root: '/notes-b', name: 'notes-b' }
  if (channel === 'workspace:current') return { root: '/notes', name: 'notes' }
  if (channel === 'tree:get') return { pages: world.tree, favorites: [] }
  if (channel === 'trash:list') return world.trash
  if (channel === 'settings:get') return world.settings
  if (channel === 'settings:set') {
    world.settings = { ...world.settings, ...(payload as Partial<Settings>) }
    return world.settings
  }
  if (channel === 'window:close') return undefined
  throw new Error(`unexpected ${channel}`)
})

let useApp: typeof import('./store').useApp

beforeAll(async () => {
  vi.stubGlobal('window', { api: { invoke, on: () => () => {} } })
  ;({ useApp } = await import('./store'))
})
afterAll(() => {
  vi.unstubAllGlobals()
})
beforeEach(() => {
  world.tree = [node('a', [node('a1')]), node('b'), node('c')]
  world.trash = []
  world.settings = {
    theme: 'system',
    sidebarWidth: 240,
    sidebarCollapsed: false,
    expanded: {},
    lastPage: {},
    tabs: {},
    recent: {},
    lastColor: { kind: 'background', color: 'yellow' }
  }
  invoke.mockClear()
})

const tabPages = (): (string | null)[] =>
  useApp.getState().tabs!.tabs.map((t) => {
    const e = t.entries[t.index]
    return e.kind === 'page' ? e.pageId : `trash:${e.entry}`
  })
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('tabs at startup', () => {
  it('restores the saved tabs of the workspace, with the same tab active', async () => {
    world.settings.tabs = {
      '/notes': {
        tabs: [
          { history: ['a'], index: 0 },
          { history: ['b', 'c'], index: 1 }
        ],
        active: 1
      }
    }
    await useApp.getState().init()
    expect(tabPages()).toEqual(['a', 'c'])
    expect(useApp.getState().currentId).toBe('c')
  })

  it('opens one tab on the last page when no tabs were saved yet', async () => {
    world.settings.lastPage = { '/notes': 'b' }
    await useApp.getState().init()
    expect(tabPages()).toEqual(['b'])
  })

  it('restores a page that is now in the Trash into the trashed view', async () => {
    world.tree = [node('b')]
    world.trash = [
      {
        entry: 'e1',
        pageId: 'a',
        pageIds: ['a', 'a1'],
        title: 'A',
        parentTitle: null,
        deletedAt: '',
        pageCount: 2
      }
    ]
    world.settings.tabs = {
      '/notes': {
        tabs: [
          { history: ['a1'], index: 0 },
          { history: ['gone'], index: 0 }
        ],
        active: 0
      }
    }
    await useApp.getState().init()
    await settle()
    expect(tabPages()).toEqual(['trash:e1'])
  })
})

describe('tabs while working', () => {
  beforeEach(async () => {
    await useApp.getState().init()
  })

  it('saves the tabs and counts the shown page as recent', async () => {
    useApp.getState().openPage('b')
    useApp.getState().openPage('c', { tab: 'background' })
    await settle()
    expect(world.settings.tabs['/notes']).toEqual({
      tabs: [
        { history: ['a', 'b'], index: 1 },
        { history: ['c'], index: 0 }
      ],
      active: 0
    })
    expect(world.settings.recent['/notes'].slice(0, 2)).toEqual(['b', 'a'])
  })

  it('counts every page opened before the last one was saved as recent', async () => {
    useApp.getState().openPage('b')
    useApp.getState().openPage('c')
    await settle()
    expect(world.settings.recent['/notes'].slice(0, 3)).toEqual(['c', 'b', 'a'])
    expect(useApp.getState().settings!.recent['/notes'].slice(0, 3)).toEqual(['c', 'b', 'a'])
  })

  it('closes the window instead of the last tab', () => {
    useApp.getState().closeTab(useApp.getState().tabs!.activeId)
    expect(invoke).toHaveBeenCalledWith('window:close', undefined)
    expect(tabPages()).toEqual(['a'])
  })

  it('shows the Trash entry in tabs whose page was deleted, and the page again once restored', async () => {
    useApp.getState().openPage('a1', { tab: 'background' })
    world.trash = [
      {
        entry: 'e1',
        pageId: 'a',
        pageIds: ['a', 'a1'],
        title: 'A',
        parentTitle: null,
        deletedAt: '',
        pageCount: 2
      }
    ]
    useApp.getState().applySnapshot({ pages: [node('b'), node('c')], favorites: [] })
    await settle()
    expect(tabPages()).toEqual(['trash:e1', 'trash:e1'])
    const entry = useApp.getState().tabs!.tabs[1].entries[0]
    expect(entry).toMatchObject({ title: 'A1', pageId: 'a1' })

    invoke.mockImplementationOnce(async () => 'a')
    await useApp.getState().restoreTrash('e1')
    expect(tabPages()).toEqual(['a', 'a1'])
  })

  it('steps a tab back when its page vanished without a Trash entry', async () => {
    useApp.getState().openPage('b')
    useApp.getState().applySnapshot({ pages: [node('a'), node('c')], favorites: [] })
    await settle()
    expect(tabPages()).toEqual(['a'])
  })

  it('closes a tab whose page vanished with nothing to step back to', async () => {
    useApp.getState().openPage('c', { tab: 'foreground' })
    useApp.getState().applySnapshot({ pages: [node('a'), node('b')], favorites: [] })
    await settle()
    expect(tabPages()).toEqual(['a'])
    expect(useApp.getState().tabs!.closed).toEqual([])
  })
})

describe('the import panel', () => {
  const done = { state: 'done', rootId: 'r', reportId: 'x', pages: 3, issues: 0 } as const

  it('closes when another workspace is chosen', async () => {
    useApp.setState({ workspace: { root: '/notes-a', name: 'notes-a' }, importStatus: done })
    await useApp.getState().chooseWorkspace()
    expect(useApp.getState().workspace?.root).toBe('/notes-b')
    expect(useApp.getState().importStatus).toBeNull()
  })

  it('closes when the workspace folder goes missing', () => {
    useApp.setState({ workspace: { root: '/notes-a', name: 'notes-a' }, importStatus: done })
    useApp.getState().workspaceMissing()
    expect(useApp.getState().importStatus).toBeNull()
  })
})
