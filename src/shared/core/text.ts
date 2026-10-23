import type { Block, Inline, TableCell } from './blocks'
import type { TextRange } from '../types'

/** The readable text of a page body, one block per line, for search. */
export function blocksText(blocks: Block[]): string {
  const lines: string[] = []
  const walk = (list: Block[]): void => {
    for (const block of list) {
      const line = blockLine(block)
      if (line) lines.push(line)
      walk(block.children)
    }
  }
  walk(blocks)
  return lines.join('\n')
}

function blockLine(block: Block): string {
  switch (block.type) {
    case 'table':
      return block.content.rows
        .map((row) => row.cells.map((cell) => inlineText(cellContent(cell))).join(' '))
        .join(' ')
    case 'codeBlock':
      return block.content.map((c) => c.text).join('')
    case 'image':
    case 'video':
    case 'audio':
      return block.props.caption
    case 'file':
      return block.props.name
    case 'math':
      return block.props.latex
    case 'raw':
      return block.props.markdown
    default:
      return 'content' in block && Array.isArray(block.content)
        ? inlineText(block.content as Inline[])
        : ''
  }
}

export function inlineText(content: Inline[]): string {
  return content
    .map((item) => {
      if (item.type === 'text') return item.text
      if (item.type === 'link') return item.content.map((c) => c.text).join('')
      if (item.type === 'pageMention') return item.props.title
      return item.props.latex
    })
    .join('')
}

function cellContent(cell: Inline[] | TableCell): Inline[] {
  return Array.isArray(cell) ? cell : cell.content
}

/** Where words starting with any of `terms` occur in `text`, merged and in order. */
export function findRanges(text: string, terms: string[]): TextRange[] {
  const ranges: TextRange[] = []
  for (const term of terms) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}`, 'giu')
    for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: TextRange[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }
  return merged
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
