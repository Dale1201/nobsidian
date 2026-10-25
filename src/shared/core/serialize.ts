import type { BlockContent, List, ListItem, PhrasingContent, RootContent, TableRow } from 'mdast'
import {
  DEFAULT_CALLOUT_BACKGROUND,
  type Block,
  type BlockColors,
  type Inline,
  type TableCell,
  type TableContent
} from './blocks'
import { isColor, renderAttrs } from './html'
import { inlineToPhrasing } from './inline'
import { decodeHref } from './paths'
import { stringifyMarkdown, stringifyPhrasing } from './processor'

export function blocksToMarkdown(blocks: Block[]): string {
  const trimmed = [...blocks]
  while (trimmed.length && isEmptyParagraph(trimmed[trimmed.length - 1])) trimmed.pop()
  if (trimmed.length === 0) return ''
  return stringifyMarkdown(blocksToFlow(trimmed))
}

function isEmptyParagraph(block: Block): boolean {
  return (
    block.type === 'paragraph' &&
    block.content.length === 0 &&
    block.children.length === 0 &&
    !isColor(block.props.textColor) &&
    !isColor(block.props.backgroundColor)
  )
}

const html = (value: string): RootContent => ({ type: 'html', value })
const colorsOf = (props: BlockColors): BlockColors => ({
  textColor: props.textColor,
  backgroundColor: props.backgroundColor
})

function blocksToFlow(blocks: Block[]): RootContent[] {
  const out: RootContent[] = []
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    if (block.type === 'bulletListItem' || block.type === 'checkListItem') {
      const items: Block[] = []
      while (
        i < blocks.length &&
        (blocks[i].type === 'bulletListItem' || blocks[i].type === 'checkListItem')
      ) {
        items.push(blocks[i++])
      }
      out.push(listNode(items, false))
      continue
    }
    if (block.type === 'numberedListItem') {
      const items: Block[] = [blocks[i++]]
      while (
        i < blocks.length &&
        blocks[i].type === 'numberedListItem' &&
        (blocks[i].props as { start?: number }).start === undefined
      ) {
        items.push(blocks[i++])
      }
      out.push(listNode(items, true))
      continue
    }
    out.push(...blockToFlow(block))
    i++
  }
  return out
}

function listNode(items: Block[], ordered: boolean): List {
  const children = items.map(listItemNode)
  const first = items[0].props as { start?: number }
  return {
    type: 'list',
    ordered,
    start: ordered ? (first.start ?? 1) : undefined,
    spread: children.some((c) => c.spread),
    children
  }
}

function listItemNode(block: Block): ListItem {
  const content =
    'content' in block && Array.isArray(block.content) ? (block.content as Inline[]) : []
  const colors = colorsOf(block.props as BlockColors)
  const phrasing = inlineToPhrasing(content, { blockColors: colors })
  // GFM only recognises `- [ ]` when the item has text, so empty to-dos get a placeholder.
  if (block.type === 'checkListItem' && content.length === 0)
    phrasing.unshift({ type: 'html', value: '&nbsp;' })
  const nested = blocksToFlow(block.children) as BlockContent[]
  const spread = block.children.some(
    (c) =>
      c.type !== 'bulletListItem' && c.type !== 'checkListItem' && c.type !== 'numberedListItem'
  )
  return {
    type: 'listItem',
    spread,
    checked: block.type === 'checkListItem' ? block.props.checked : null,
    children: [
      ...(phrasing.length ? [{ type: 'paragraph' as const, children: phrasing }] : []),
      ...nested
    ]
  }
}

function paragraphOf(content: Inline[], colors: BlockColors): RootContent {
  const phrasing = inlineToPhrasing(content, { blockColors: colors })
  if (content.length === 0) phrasing.unshift({ type: 'html', value: '&nbsp;' })
  return { type: 'paragraph', children: phrasing }
}

function childrenContainer(children: Block[]): RootContent[] {
  if (children.length === 0) return []
  return [html('<div data-children>'), ...blocksToFlow(children), html('</div>')]
}

function blockToFlow(block: Block): RootContent[] {
  switch (block.type) {
    case 'paragraph':
      return [
        paragraphOf(block.content, colorsOf(block.props)),
        ...childrenContainer(block.children)
      ]
    case 'heading': {
      if (block.props.isToggleable)
        return detailsFlow(block.content, colorsOf(block.props), block.children, block.props.level)
      const depth = Math.min(Math.max(block.props.level, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6
      return [
        {
          type: 'heading',
          depth,
          children: inlineToPhrasing(block.content, { blockColors: colorsOf(block.props) })
        },
        ...childrenContainer(block.children)
      ]
    }
    case 'toggleListItem':
      return detailsFlow(block.content, colorsOf(block.props), block.children)
    case 'quote': {
      const lead =
        block.content.length || block.children.length
          ? [paragraphOf(block.content, colorsOf(block.props))]
          : []
      return [
        {
          type: 'blockquote',
          children: [...lead, ...blocksToFlow(block.children)] as BlockContent[]
        }
      ]
    }
    case 'callout': {
      const tokens: string[] = []
      if (isColor(block.props.textColor)) tokens.push(block.props.textColor)
      const bg = block.props.backgroundColor ?? DEFAULT_CALLOUT_BACKGROUND
      if (bg !== DEFAULT_CALLOUT_BACKGROUND) tokens.push(`${bg || 'default'}_bg`)
      const marker = `[!callout${tokens.map((t) => `:${t}`).join('')}]${block.props.icon ? ` ${block.props.icon}` : ''}`
      const phrasing = inlineToPhrasing(block.content)
      const lead: PhrasingContent[] = [
        { type: 'html', value: phrasing.length ? `${marker}\n` : marker },
        ...phrasing
      ]
      return [
        {
          type: 'blockquote',
          children: [
            { type: 'paragraph', children: lead },
            ...blocksToFlow(block.children)
          ] as BlockContent[]
        }
      ]
    }
    case 'codeBlock': {
      const value = block.content.map((c) => c.text).join('')
      const lang =
        block.props.language && block.props.language !== 'text' ? block.props.language : null
      return [{ type: 'code', lang, value }, ...childrenContainer(block.children)]
    }
    case 'math':
      return [{ type: 'math', value: block.props.latex }, ...childrenContainer(block.children)]
    case 'divider':
      return [{ type: 'thematicBreak' }, ...childrenContainer(block.children)]
    case 'toc':
      return [html('<nav data-toc></nav>'), ...childrenContainer(block.children)]
    case 'table':
      return [tableNode(block.content), ...childrenContainer(block.children)]
    case 'image': {
      const { url, caption, previewWidth } = block.props
      const node: RootContent = previewWidth
        ? html(`<img${renderAttrs({ src: url, alt: caption || undefined, width: previewWidth })}>`)
        : { type: 'paragraph', children: [{ type: 'image', url, alt: caption || null }] }
      return [node, ...childrenContainer(block.children)]
    }
    case 'drawing':
      // A drawing that was never saved has no file to point at.
      if (!block.props.url) return blocksToFlow(block.children)
      return [
        { type: 'paragraph', children: [{ type: 'image', url: block.props.url, alt: null }] },
        ...childrenContainer(block.children)
      ]
    case 'video':
    case 'audio': {
      const attrs = renderAttrs({
        src: block.props.url,
        'data-caption': block.props.caption || undefined,
        controls: true
      })
      return [html(`<${block.type}${attrs}></${block.type}>`), ...childrenContainer(block.children)]
    }
    case 'file': {
      const name = block.props.name || decodeHref(block.props.url.split('/').pop() ?? 'file')
      return [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: block.props.url,
              title: 'file',
              children: [{ type: 'text', value: name }]
            }
          ]
        },
        ...childrenContainer(block.children)
      ]
    }
    case 'pageLink':
      return [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: block.props.href,
              title: 'page',
              children: [{ type: 'text', value: pageLabel(block.props.href) }]
            }
          ]
        }
      ]
    case 'raw':
      return [html(block.props.markdown), ...childrenContainer(block.children)]
    case 'columnList':
      return [
        html('<div data-columns>'),
        ...block.children.flatMap((col) => blockToFlow(col)),
        html('</div>')
      ]
    case 'column': {
      const width = block.props.width
      const open =
        width === undefined || width === 1
          ? '<div data-column>'
          : `<div data-column data-width="${width}">`
      return [html(open), ...blocksToFlow(block.children), html('</div>')]
    }
    case 'bulletListItem':
    case 'numberedListItem':
    case 'checkListItem':
      return [listNode([block], block.type === 'numberedListItem')]
  }
}

function detailsFlow(
  content: Inline[],
  colors: BlockColors,
  children: Block[],
  heading?: number
): RootContent[] {
  const summary = stringifyPhrasing(inlineToPhrasing(content, { blockColors: colors }))
  const open = heading ? `<details data-heading="${heading}">` : '<details>'
  return [
    html(`${open}\n<summary>${summary}</summary>`),
    ...blocksToFlow(children),
    html('</details>')
  ]
}

function pageLabel(href: string): string {
  const file = href.split('/').pop() ?? href
  return decodeHref(file).replace(/\.md$/i, '')
}

function tableNode(content: TableContent): RootContent {
  const rows: TableRow[] = content.rows.map((row) => ({
    type: 'tableRow',
    children: row.cells.map((cell) => ({
      type: 'tableCell',
      children: inlineToPhrasing(cellContent(cell), { newlineAsHtml: true })
    }))
  }))
  return { type: 'table', align: rows[0]?.children.map(() => null) ?? [], children: rows }
}

function cellContent(cell: Inline[] | TableCell): Inline[] {
  return Array.isArray(cell) ? cell : cell.content
}
