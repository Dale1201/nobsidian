import { DEFAULT_CALLOUT_BACKGROUND, type Block, type Inline, type StyledText } from './blocks'
import { isColor } from './html'
import { cleanStyles, sameStyles } from './inline'

// Reduces editor-shaped blocks (ids, default props, TableCell objects) to the
// minimal form markdownToBlocks produces, so documents can be compared.
export function normalizeBlocks(blocks: Block[]): Block[] {
  const out = blocks.map(normalizeBlock)
  while (out.length) {
    const last = out[out.length - 1]
    const empty =
      last.type === 'paragraph' &&
      last.content.length === 0 &&
      last.children.length === 0 &&
      Object.keys(last.props).length === 0
    if (!empty) break
    out.pop()
  }
  return out
}

const KEEP_PROPS: Record<string, string[]> = {
  paragraph: ['textColor', 'backgroundColor'],
  heading: ['level', 'isToggleable', 'textColor', 'backgroundColor'],
  bulletListItem: ['textColor', 'backgroundColor'],
  numberedListItem: ['start', 'textColor', 'backgroundColor'],
  checkListItem: ['checked', 'textColor', 'backgroundColor'],
  toggleListItem: ['textColor', 'backgroundColor'],
  quote: ['textColor', 'backgroundColor'],
  callout: ['icon', 'textColor', 'backgroundColor'],
  codeBlock: ['language'],
  table: [],
  divider: [],
  image: ['url', 'caption', 'previewWidth'],
  video: ['url', 'caption'],
  audio: ['url', 'caption'],
  file: ['url', 'name'],
  math: ['latex'],
  pageLink: ['href'],
  raw: ['markdown'],
  columnList: [],
  column: ['width'],
  toc: []
}

function normalizeBlock(block: Block): Block {
  const props: Record<string, unknown> = {}
  for (const key of KEEP_PROPS[block.type] ?? []) {
    const value = (block.props as Record<string, unknown>)[key]
    if (value === undefined || value === null) continue
    if ((key === 'textColor' || key === 'backgroundColor') && !isColor(value as string)) {
      if (!(block.type === 'callout' && key === 'backgroundColor')) continue
    }
    if (
      block.type === 'callout' &&
      key === 'backgroundColor' &&
      value === DEFAULT_CALLOUT_BACKGROUND
    )
      continue
    if (key === 'isToggleable' && value !== true) continue
    if (key === 'start' && value === 1) continue
    if (key === 'caption' && value === '') continue
    props[key] = value
  }
  const base = { type: block.type, props, children: block.children.map(normalizeBlock) }
  if (block.type === 'table') {
    return {
      ...base,
      content: {
        type: 'tableContent',
        rows: block.content.rows.map((r) => ({
          cells: r.cells.map((c) => normalizeInline(Array.isArray(c) ? c : c.content))
        }))
      }
    } as Block
  }
  if (block.type === 'codeBlock') {
    const text = block.content.map((c) => c.text).join('')
    return { ...base, content: text ? [{ type: 'text', text, styles: {} }] : [] } as Block
  }
  if ('content' in block && Array.isArray(block.content)) {
    return { ...base, content: normalizeInline(block.content as Inline[]) } as Block
  }
  return base as Block
}

export function normalizeInline(content: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const item of content) {
    if (item.type === 'text') {
      if (item.text === '') continue
      const styles = cleanStyles(item.styles)
      const last = out[out.length - 1]
      if (last?.type === 'text' && sameStyles(last.styles, styles)) last.text += item.text
      else out.push({ type: 'text', text: item.text, styles })
    } else if (item.type === 'link') {
      out.push({
        type: 'link',
        href: item.href,
        content: normalizeInline(item.content) as StyledText[]
      })
    } else {
      out.push({ type: 'inlineMath', props: { latex: item.props.latex } })
    }
  }
  return out
}
