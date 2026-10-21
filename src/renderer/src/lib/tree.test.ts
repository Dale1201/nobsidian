import { describe, expect, it } from 'vitest'
import type { PageNode } from '@shared/types'
import { dropTarget, pathTo } from './tree'

const node = (id: string, children: PageNode[] = []): PageNode => ({
  id,
  title: id,
  path: `${id}.md`,
  children
})
const tree = [node('a', [node('a1'), node('a2')]), node('b'), node('c')]

describe('tree helpers', () => {
  it('finds the path to a node', () => {
    expect(pathTo(tree, 'a2').map((n) => n.id)).toEqual(['a', 'a2'])
    expect(pathTo(tree, 'zzz')).toEqual([])
  })

  it('computes drop targets', () => {
    expect(dropTarget(tree, 'c', 'a', 'before')).toEqual({ parentId: null, index: 0 })
    expect(dropTarget(tree, 'a', 'c', 'after')).toEqual({ parentId: null, index: 2 })
    expect(dropTarget(tree, 'b', 'a', 'inside')).toEqual({ parentId: 'a', index: 2 })
    expect(dropTarget(tree, 'a1', 'a2', 'after')).toEqual({ parentId: 'a', index: 1 })
  })

  it('refuses to drop a page into itself or its descendants', () => {
    expect(dropTarget(tree, 'a', 'a1', 'inside')).toBeNull()
    expect(dropTarget(tree, 'a', 'a', 'before')).toBeNull()
  })
})
