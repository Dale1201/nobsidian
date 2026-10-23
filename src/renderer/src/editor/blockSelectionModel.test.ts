import { describe, expect, it } from 'vitest'
import { stepSelection, topLevelIds, type OutlineNode } from './blockSelectionModel'

const node = (id: string, children: OutlineNode[] = []): OutlineNode => ({ id, children })
const doc = [node('a', [node('a1'), node('a2')]), node('b'), node('c')]

describe('stepSelection', () => {
  it('moves through blocks in reading order, children included', () => {
    expect(stepSelection(doc, ['a'], 1, false)).toEqual(['a1'])
    expect(stepSelection(doc, ['a2'], 1, false)).toEqual(['b'])
    expect(stepSelection(doc, ['b'], -1, false)).toEqual(['a2'])
  })

  it('stops at the ends', () => {
    expect(stepSelection(doc, ['a'], -1, false)).toEqual(['a'])
    expect(stepSelection(doc, ['c'], 1, false)).toEqual(['c'])
  })

  it('extends with Shift', () => {
    expect(stepSelection(doc, ['b'], 1, true)).toEqual(['b', 'c'])
    expect(stepSelection(doc, ['b'], -1, true)).toEqual(['a2', 'b'])
  })
})

describe('stepSelection with hidden blocks', () => {
  it('skips blocks that cannot be selected, such as closed toggle children', () => {
    const visible = (id: string): boolean => id !== 'a1' && id !== 'a2'
    expect(stepSelection(doc, ['a'], 1, false, visible)).toEqual(['b'])
    expect(stepSelection(doc, ['b'], -1, false, visible)).toEqual(['a'])
  })
})

describe('topLevelIds', () => {
  it('drops blocks whose parent is selected too', () => {
    expect(topLevelIds(doc, ['a', 'a1', 'b'])).toEqual(['a', 'b'])
    expect(topLevelIds(doc, ['a1', 'a2'])).toEqual(['a1', 'a2'])
  })
})
