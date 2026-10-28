import type { Block, PageLinkBlock } from './blocks'
import { pageLinkHref } from './links'

// A parent shows each sub-page as a page link block, like Notion's page blocks.

function linkBlock(id: string): PageLinkBlock {
  return { type: 'pageLink', props: { href: pageLinkHref(id) }, children: [] }
}

function isLinkTo(block: Block, id: string): boolean {
  return block.type === 'pageLink' && block.props.href === pageLinkHref(id)
}

function isEmptyParagraph(block: Block): boolean {
  return block.type === 'paragraph' && block.content.length === 0 && block.children.length === 0
}

export function linksToSubPage(blocks: Block[], id: string): boolean {
  return blocks.some((b) => isLinkTo(b, id) || linksToSubPage(b.children, id))
}

/** Adds a link at the end, above trailing empty lines; null when one is already there. */
export function appendSubPageLink(blocks: Block[], id: string): Block[] | null {
  if (linksToSubPage(blocks, id)) return null
  let end = blocks.length
  while (end > 0 && isEmptyParagraph(blocks[end - 1])) end--
  return [...blocks.slice(0, end), linkBlock(id), ...blocks.slice(end)]
}

/** Adds a link right after the first link to `after`, or at the end without one. */
export function insertSubPageLinkAfter(blocks: Block[], after: string, id: string): Block[] | null {
  if (linksToSubPage(blocks, id)) return null
  if (!linksToSubPage(blocks, after)) return appendSubPageLink(blocks, id)
  let placed = false
  const place = (list: Block[]): Block[] =>
    list.flatMap((b): Block[] => {
      if (placed) return [b]
      if (isLinkTo(b, after)) {
        placed = true
        return [b, linkBlock(id)]
      }
      return [{ ...b, children: place(b.children) } as Block]
    })
  return place(blocks)
}

/** Where a link sits: its index at each nesting level, and the type of each block it is in. */
export interface LinkPlace {
  path: number[]
  within: string[]
}

/** Where the first link to the page sits, through nested children; null without one. */
export function subPageLinkPlace(blocks: Block[], id: string): LinkPlace | null {
  for (const [i, b] of blocks.entries()) {
    if (isLinkTo(b, id)) return { path: [i], within: [] }
    const inner = subPageLinkPlace(b.children, id)
    if (inner) return { path: [i, ...inner.path], within: [b.type, ...inner.within] }
  }
  return null
}

/** Adds a link back at its place, or at the end once the place no longer fits; null when linked. */
export function insertSubPageLinkAt(blocks: Block[], id: string, at: LinkPlace): Block[] | null {
  if (linksToSubPage(blocks, id)) return null
  const insert = (list: Block[], depth: number): Block[] | null => {
    const i = at.path[depth]
    if (depth === at.path.length - 1) {
      return i <= list.length ? [...list.slice(0, i), linkBlock(id), ...list.slice(i)] : null
    }
    // Only into a block of the type that held it, so an edited parent never nests it elsewhere.
    const holder = list[i]
    const children = holder?.type === at.within[depth] ? insert(holder.children, depth + 1) : null
    return children ? list.map((b, j) => (j === i ? ({ ...b, children } as Block) : b)) : null
  }
  return insert(blocks, 0) ?? appendSubPageLink(blocks, id)
}

/** Removes every link to the page; null when there is none. */
export function removeSubPageLinks(blocks: Block[], id: string): Block[] | null {
  if (!linksToSubPage(blocks, id)) return null
  const strip = (list: Block[]): Block[] =>
    list
      .filter((b) => !isLinkTo(b, id))
      .map((b): Block => {
        const children = strip(b.children)
        // A column must keep a block, or the editor can't show it.
        if (b.type === 'column' && children.length === 0) {
          return { ...b, children: [{ type: 'paragraph', props: {}, content: [], children: [] }] }
        }
        return { ...b, children } as Block
      })
  return strip(blocks)
}
