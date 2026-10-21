import type { Block, Inline } from './blocks'

export const PAGE_LINK_PREFIX = 'nobsidian://page/'

export function pageLinkHref(id: string): string {
  return PAGE_LINK_PREFIX + id
}

export function pageIdFromHref(href: string): string | null {
  return href.startsWith(PAGE_LINK_PREFIX) ? href.slice(PAGE_LINK_PREFIX.length) : null
}

/** Returns copies of `blocks` with every link target passed through `map`. */
export function mapBlockLinks(blocks: Block[], map: (href: string) => string): Block[] {
  return blocks.map((block) => mapBlock(block, map))
}

function mapBlock(block: Block, map: (href: string) => string): Block {
  const children = mapBlockLinks(block.children, map)
  switch (block.type) {
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
      return {
        ...block,
        props: { ...block.props, url: mapNonEmpty(block.props.url, map) },
        children
      } as Block
    case 'pageLink':
      return {
        ...block,
        props: { ...block.props, href: mapNonEmpty(block.props.href, map) },
        children
      }
    case 'table':
      return {
        ...block,
        content: {
          ...block.content,
          rows: block.content.rows.map((row) => ({
            cells: row.cells.map((cell) =>
              Array.isArray(cell)
                ? mapInline(cell, map)
                : { ...cell, content: mapInline(cell.content, map) }
            )
          }))
        },
        children
      }
    default:
      if ('content' in block && Array.isArray(block.content) && block.type !== 'codeBlock') {
        return { ...block, content: mapInline(block.content as Inline[], map), children } as Block
      }
      return { ...block, children } as Block
  }
}

function mapInline(content: Inline[], map: (href: string) => string): Inline[] {
  return content.map((item) =>
    item.type === 'link' ? { ...item, href: mapNonEmpty(item.href, map) } : item
  )
}

function mapNonEmpty(href: string, map: (href: string) => string): string {
  return href === '' ? href : map(href)
}
