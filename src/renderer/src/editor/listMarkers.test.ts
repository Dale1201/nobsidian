import { describe, expect, it } from 'vitest'
import { bulletMarker, numberMarker } from './listMarkers'

describe('list markers', () => {
  it('cycles bullets by depth like Notion', () => {
    expect([0, 1, 2, 3, 4].map(bulletMarker)).toEqual(['•', '◦', '▪', '•', '◦'])
  })

  it('numbers as decimal, then letters, then roman numerals', () => {
    expect(numberMarker(1, 0)).toBe('1.')
    expect(numberMarker(12, 0)).toBe('12.')
    expect(numberMarker(2, 1)).toBe('b.')
    expect(numberMarker(27, 1)).toBe('aa.')
    expect(numberMarker(4, 2)).toBe('iv.')
    expect(numberMarker(1994, 2)).toBe('mcmxciv.')
    expect(numberMarker(3, 3)).toBe('3.')
  })
})
