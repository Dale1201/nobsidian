import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { LinkClick } from './navigation'

const click = (button: number, metaKey = false, shiftKey = false): LinkClick => ({
  button,
  metaKey,
  shiftKey
})

beforeAll(() => {
  vi.stubGlobal('window', { api: { invoke: vi.fn(), on: () => () => {} } })
})
afterAll(() => {
  vi.unstubAllGlobals()
})

describe('where a click opens a page', () => {
  it('opens in the current tab on a plain click, and in a new tab with Cmd or the middle button', async () => {
    const { tabTarget } = await import('./navigation')
    expect(tabTarget(click(0))).toBe('current')
    expect(tabTarget(click(0, false, true))).toBe('current')
    expect(tabTarget(click(0, true))).toBe('background')
    expect(tabTarget(click(0, true, true))).toBe('foreground')
    expect(tabTarget(click(1))).toBe('background')
    expect(tabTarget(click(1, false, true))).toBe('foreground')
  })
})
