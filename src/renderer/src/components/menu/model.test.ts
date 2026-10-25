import { describe, expect, it } from 'vitest'
import { filterEntries, moveIndex, type MenuEntry } from './model'

const entries: MenuEntry[] = [
  { kind: 'section', label: 'Actions' },
  {
    kind: 'item',
    id: 'turn',
    label: 'Turn into',
    submenu: [
      { kind: 'item', id: 'h1', label: 'Heading 1' },
      { kind: 'item', id: 'quote', label: 'Quote', keywords: ['blockquote'] }
    ]
  },
  { kind: 'separator' },
  { kind: 'item', id: 'dup', label: 'Duplicate' },
  { kind: 'item', id: 'del', label: 'Delete', danger: true }
]

const ids = (list: MenuEntry[]): string[] => list.map((e) => (e.kind === 'item' ? e.id : e.kind))

describe('filterEntries', () => {
  it('returns everything for an empty query', () => {
    expect(filterEntries(entries, '  ')).toBe(entries)
  })

  it('matches labels and keywords, every word, ignoring case', () => {
    expect(ids(filterEntries(entries, 'DUP'))).toEqual(['section', 'dup'])
    expect(ids(filterEntries(entries, 'block'))).toEqual(['section', 'quote'])
    expect(ids(filterEntries(entries, 'heading 1'))).toEqual(['section', 'h1'])
  })

  it('finds submenu items and drops sections and separators left empty', () => {
    expect(ids(filterEntries(entries, 'turn'))).toEqual(['section', 'turn'])
    expect(ids(filterEntries(entries, 'zzz'))).toEqual([])
  })
})

describe('moveIndex', () => {
  it('skips sections and separators and wraps around', () => {
    expect(moveIndex(entries, -1, 1)).toBe(1)
    expect(moveIndex(entries, 1, 1)).toBe(3)
    expect(moveIndex(entries, 4, 1)).toBe(1)
    expect(moveIndex(entries, 1, -1)).toBe(4)
  })

  it('skips disabled items', () => {
    const some: MenuEntry[] = [
      { kind: 'item', id: 'a', label: 'A' },
      { kind: 'item', id: 'b', label: 'B', disabled: true },
      { kind: 'item', id: 'c', label: 'C' }
    ]
    expect(moveIndex(some, 0, 1)).toBe(2)
    expect(moveIndex(some, 2, -1)).toBe(0)
  })

  it('returns -1 when there is nothing to select', () => {
    expect(moveIndex([{ kind: 'separator' }], -1, 1)).toBe(-1)
  })
})
