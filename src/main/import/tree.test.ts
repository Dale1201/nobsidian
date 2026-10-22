import { describe, expect, it } from 'vitest'
import { buildTree, exportPages } from './tree'

const id = (n: number): string => n.toString(16).padStart(32, '0')

describe('exportPages', () => {
  it('reads the Notion id and the folder sub-pages live in', () => {
    expect(
      exportPages([`S/Plans ${id(1)}.html`, 'S/Plans/image.png', `Top ${id(2)}.html`])
    ).toEqual([
      { notionId: id(1), path: `S/Plans ${id(1)}.html`, folder: 'S/Plans' },
      { notionId: id(2), path: `Top ${id(2)}.html`, folder: 'Top' }
    ])
  })
})

describe('buildTree', () => {
  it('tells apart same-titled siblings that share a folder by their links', () => {
    const pages = exportPages([
      `S/Root ${id(1)}.html`,
      `S/Root/Same ${id(2)}.html`,
      `S/Root/Same ${id(3)}.html`,
      `S/Root/Same/Child A ${id(4)}.html`,
      `S/Root/Same/Child B ${id(5)}.html`
    ])
    const links = new Map([
      [id(1), [id(3), id(2)]],
      [id(2), [id(5)]],
      [id(3), [id(4)]]
    ])
    const { nodes, order } = buildTree(pages, links)
    expect(nodes.get(id(4))!.parent).toBe(id(3))
    expect(nodes.get(id(5))!.parent).toBe(id(2))
    expect(order.get(id(1))).toEqual([id(3), id(2)])
    expect(nodes.get(id(1))).toEqual({ notionId: id(1), parent: null, group: 'S' })
  })

  it('ignores links to pages outside the linking page’s folder', () => {
    const pages = exportPages([`S/A ${id(1)}.html`, `S/B ${id(2)}.html`])
    const { nodes } = buildTree(pages, new Map([[id(1), [id(2)]]]))
    expect(nodes.get(id(2))!.parent).toBeNull()
  })

  it('puts a page nothing links to under its folder’s page', () => {
    const pages = exportPages([`S/A ${id(1)}.html`, `S/A/Lost ${id(2)}.html`])
    const { nodes, order } = buildTree(pages, new Map())
    expect(nodes.get(id(2))!.parent).toBe(id(1))
    expect(order.get(id(1))).toEqual([id(2)])
  })
})
