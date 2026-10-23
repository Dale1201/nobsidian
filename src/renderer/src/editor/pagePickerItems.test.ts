import { describe, expect, it } from 'vitest'
import { rankPages, type PickerPage } from './pagePickerItems'

const pages: PickerPage[] = [
  { id: '1', title: 'Rust', path: 'Notes' },
  { id: '2', title: 'Ownership', path: 'Notes / Rust' },
  { id: '3', title: 'Trust fund', path: '' },
  { id: '4', title: 'Groceries', path: '' }
]

describe('rankPages', () => {
  it('shows recent pages first for an empty query', () => {
    expect(rankPages(pages, ['4', '2'], '').map((p) => p.id)).toEqual(['4', '2', '1', '3'])
  })

  it('ranks title starts before other matches, ignoring case', () => {
    expect(rankPages(pages, [], 'RU').map((p) => p.id)).toEqual(['1', '3'])
  })

  it('limits the list', () => {
    expect(rankPages(pages, [], '', 2)).toHaveLength(2)
  })
})
