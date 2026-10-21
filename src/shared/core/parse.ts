import type {
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  RootContent,
  Table,
  Blockquote
} from 'mdast'
import type { Block, BlockColors, Inline, TableContent } from './blocks'
import { parseAttrs, parseBlockColorComment } from './html'
import { phrasingToInline } from './inline'
import { parseMarkdown, stringifyMarkdown } from './processor'

export function markdownToBlocks(markdown: string): Block[] {
  return parseFlow(parseMarkdown(markdown).children)
}

const NBSP = ' '
const DETAILS_OPEN = /^<details(?: data-heading="([1-6])")?>\n<summary>([\s\S]*)<\/summary>$/
const DIV_OPEN = /^<div data-(columns|column|children)(?: data-width="([0-9.]+)")?>$/
const CALLOUT_MARKER = /^\[!callout((?::[a-z_]+)*)\][ \t]*([^\n]*)\n?/

function parseFlow(nodes: RootContent[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    if (node.type === 'html') {
      const container = matchContainer(node.value)
      if (container) {
        const end = findClose(nodes, i, container.family)
        if (end !== -1) {
          const inner = nodes.slice(i + 1, end)
          const built = buildContainer(container, inner, out)
          out.push(...built)
          i = end + 1
          continue
        }
      }
    }
    out.push(...parseNode(node))
    i++
  }
  return out
}

type Container =
  | { family: 'details'; heading?: number; summary: string }
  | { family: 'div'; kind: 'columns' | 'column' | 'children'; width?: number }

function matchContainer(value: string): Container | null {
  const details = DETAILS_OPEN.exec(value)
  if (details) {
    return {
      family: 'details',
      heading: details[1] ? Number(details[1]) : undefined,
      summary: details[2]
    }
  }
  const div = DIV_OPEN.exec(value)
  if (div) {
    return {
      family: 'div',
      kind: div[1] as 'columns' | 'column' | 'children',
      width: div[2] ? Number(div[2]) : undefined
    }
  }
  return null
}

function findClose(nodes: RootContent[], openIndex: number, family: 'details' | 'div'): number {
  const open = family === 'details' ? /^<details\b/ : /^<div\b/
  const close = family === 'details' ? /^<\/details>$/ : /^<\/div>$/
  let depth = 0
  for (let j = openIndex; j < nodes.length; j++) {
    const n = nodes[j]
    if (n.type !== 'html') continue
    if (open.test(n.value)) depth++
    else if (close.test(n.value.trim())) {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

function buildContainer(container: Container, inner: RootContent[], preceding: Block[]): Block[] {
  if (container.family === 'details') {
    const { content, colors } = parseInlineSource(container.summary)
    const children = parseFlow(inner)
    if (container.heading) {
      return [
        {
          type: 'heading',
          props: { level: container.heading, isToggleable: true, ...colors },
          content,
          children
        }
      ]
    }
    return [{ type: 'toggleListItem', props: { ...colors }, content, children }]
  }
  const children = parseFlow(inner)
  switch (container.kind) {
    case 'columns':
      return [
        {
          type: 'columnList',
          props: {},
          children: children.filter((c) => c.type === 'column')
        }
      ]
    case 'column':
      return [{ type: 'column', props: { width: container.width ?? 1 }, children }]
    case 'children': {
      const parent = preceding[preceding.length - 1]
      if (parent) {
        parent.children.push(...children)
        return []
      }
      return children
    }
  }
}

function parseInlineSource(source: string): { content: Inline[]; colors: BlockColors } {
  if (source.trim() === '') return { content: [], colors: {} }
  const root = parseMarkdown(source)
  const first = root.children[0]
  if (first?.type === 'paragraph') return normalizeEmpty(phrasingToInline(first.children))
  if (first?.type === 'html') {
    const colors = parseBlockColorComment(first.value)
    if (colors) return { content: [], colors }
  }
  return { content: [{ type: 'text', text: source, styles: {} }], colors: {} }
}

function normalizeEmpty(parsed: { content: Inline[]; colors: BlockColors }): {
  content: Inline[]
  colors: BlockColors
} {
  const only = parsed.content[0]
  if (parsed.content.length === 1 && only.type === 'text' && only.text === NBSP) {
    return { content: [], colors: parsed.colors }
  }
  return parsed
}

function parseNode(node: RootContent): Block[] {
  switch (node.type) {
    case 'paragraph':
      return [parseParagraph(node)]
    case 'heading': {
      const { content, colors } = phrasingToInline(node.children)
      return [{ type: 'heading', props: { level: node.depth, ...colors }, content, children: [] }]
    }
    case 'list':
      return parseList(node)
    case 'blockquote':
      return [parseBlockquote(node)]
    case 'code':
      return [
        {
          type: 'codeBlock',
          props: { language: node.lang || 'text' },
          content: node.value ? [{ type: 'text', text: node.value, styles: {} }] : [],
          children: []
        }
      ]
    case 'math':
      return [{ type: 'math', props: { latex: node.value }, children: [] }]
    case 'thematicBreak':
      return [{ type: 'divider', props: {}, children: [] }]
    case 'table':
      return [parseTable(node)]
    case 'html': {
      const media = parseMediaHtml(node.value)
      if (media) return [media]
      const colors = parseBlockColorComment(node.value)
      if (colors) return [{ type: 'paragraph', props: { ...colors }, content: [], children: [] }]
      return [rawBlock(node)]
    }
    default:
      return [rawBlock(node)]
  }
}

function rawBlock(node: RootContent): Block {
  return {
    type: 'raw',
    props: { markdown: stringifyMarkdown([node]).replace(/\n+$/, '') },
    children: []
  }
}

function parseParagraph(node: Paragraph): Block {
  const kids = node.children
  if (kids.length === 1 && kids[0].type === 'image') {
    return {
      type: 'image',
      props: { url: kids[0].url, caption: kids[0].alt ?? '' },
      children: []
    }
  }
  if (kids.length === 1 && kids[0].type === 'link' && kids[0].title === 'page') {
    return { type: 'pageLink', props: { href: kids[0].url }, children: [] }
  }
  if (kids.length === 1 && kids[0].type === 'link' && kids[0].title === 'file') {
    const name = kids[0].children.map((c) => ('value' in c ? c.value : '')).join('')
    return { type: 'file', props: { url: kids[0].url, name }, children: [] }
  }
  if (hasUnsupportedPhrasing(kids)) return rawBlock(node)
  if (kids.length > 0 && kids.every((k) => k.type === 'html')) {
    const media = parseMediaHtml(kids.map((k) => (k as { value: string }).value).join(''))
    if (media) return media
  }
  const { content, colors } = normalizeEmpty(phrasingToInline(kids))
  return { type: 'paragraph', props: { ...colors }, content, children: [] }
}

const UNSUPPORTED_PHRASING = new Set(['footnoteReference', 'linkReference', 'imageReference'])

function hasUnsupportedPhrasing(nodes: PhrasingContent[]): boolean {
  return nodes.some(
    (n) =>
      UNSUPPORTED_PHRASING.has(n.type) ||
      ('children' in n && hasUnsupportedPhrasing(n.children as PhrasingContent[]))
  )
}

function parseMediaHtml(value: string): Block | null {
  const html = value.trim()
  if (/^<img\b[^>]*>$/i.test(html)) {
    const a = parseAttrs(html)
    const width = a.width ? Number(a.width) : undefined
    return {
      type: 'image',
      props: {
        url: a.src ?? '',
        caption: a.alt ?? '',
        ...(width ? { previewWidth: width } : {})
      },
      children: []
    }
  }
  const media = /^<(video|audio)\b[^>]*><\/\1>$/i.exec(html)
  if (media) {
    const a = parseAttrs(html)
    const type = media[1].toLowerCase() as 'video' | 'audio'
    return { type, props: { url: a.src ?? '', caption: a['data-caption'] ?? '' }, children: [] }
  }
  return null
}

function parseList(list: List): Block[] {
  const out: Block[] = []
  list.children.forEach((item, index) => out.push(parseListItem(list, item, index)))
  return out
}

function parseListItem(list: List, item: ListItem, index: number): Block {
  let rest = item.children
  let content: Inline[] = []
  let colors: BlockColors = {}
  const first = rest[0]
  if (first?.type === 'paragraph') {
    ;({ content, colors } = normalizeEmpty(phrasingToInline(first.children)))
    rest = rest.slice(1)
  } else if (first?.type === 'html' && parseBlockColorComment(first.value)) {
    colors = parseBlockColorComment(first.value) ?? {}
    rest = rest.slice(1)
  }
  const children = parseFlow(rest)
  if (typeof item.checked === 'boolean') {
    return { type: 'checkListItem', props: { checked: item.checked, ...colors }, content, children }
  }
  if (list.ordered) {
    const start = index === 0 && list.start != null && list.start !== 1 ? list.start : undefined
    return {
      type: 'numberedListItem',
      props: { ...(start !== undefined ? { start } : {}), ...colors },
      content,
      children
    }
  }
  return { type: 'bulletListItem', props: { ...colors }, content, children }
}

function parseBlockquote(node: Blockquote): Block {
  const [first, ...rest] = node.children
  if (first?.type === 'paragraph') {
    const lead = first.children[0]
    if (lead?.type === 'text') {
      const marker = CALLOUT_MARKER.exec(lead.value)
      if (marker) {
        const remaining = lead.value.slice(marker[0].length)
        const phrasing: PhrasingContent[] = [
          ...(remaining ? [{ type: 'text' as const, value: remaining }] : []),
          ...first.children.slice(1)
        ]
        const { content } = phrasingToInline(phrasing)
        const colors: BlockColors = {}
        for (const token of marker[1].split(':').filter(Boolean)) {
          if (token.endsWith('_bg')) colors.backgroundColor = token.slice(0, -3)
          else colors.textColor = token
        }
        return {
          type: 'callout',
          props: { icon: marker[2].trim(), ...colors },
          content,
          children: parseFlow(rest)
        }
      }
    }
    const { content, colors } = normalizeEmpty(phrasingToInline(first.children))
    return { type: 'quote', props: { ...colors }, content, children: parseFlow(rest) }
  }
  return { type: 'quote', props: {}, content: [], children: parseFlow(node.children) }
}

function parseTable(node: Table): Block {
  const width = Math.max(...node.children.map((r) => r.children.length))
  const content: TableContent = {
    type: 'tableContent',
    rows: node.children.map((row) => ({
      cells: Array.from({ length: width }, (_, c) => {
        const cell = row.children[c]
        return cell ? phrasingToInline(cell.children).content : []
      })
    }))
  }
  return { type: 'table', props: {}, content, children: [] }
}
