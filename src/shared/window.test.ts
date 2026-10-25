import { describe, expect, it } from 'vitest'
import { windowControls } from './window'

describe('window controls', () => {
  it('centres the traffic lights in the tab bar, bigger from macOS 26', () => {
    expect(windowControls('15.6')).toEqual({ x: 12, y: 12, inset: 70 })
    expect(windowControls('26.7.1')).toEqual({ x: 14, y: 11, inset: 81 })
  })
})
