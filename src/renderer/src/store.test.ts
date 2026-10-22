import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PageNode } from '@shared/types'

const page: PageNode = { id: 'p1', title: 'Page', children: [] } as unknown as PageNode
const invoke = vi.fn(async (channel: string): Promise<unknown> => {
  if (channel === 'workspace:choose') return { root: '/notes-b', name: 'notes-b' }
  if (channel === 'tree:get') return { pages: [page], favorites: [] }
  if (channel === 'workspace:current') return null
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
