import type { PhrasingContent } from 'mdast'
import type { BlockColors, Inline, LinkInline, StyledText, Styles } from './blocks'
import { isColor, parseAttrs, parseBlockColorComment, renderBlockColorComment } from './html'

// ---------- Markdown -> inline content ----------

interface HtmlMark {
  tag: 'u' | 'span'
  styles: Styles
}

export interface ParsedInline {
  content: Inline[]
  colors: BlockColors
}

export function phrasingToInline(nodes: PhrasingContent[]): ParsedInline {
  const out: Inline[] = []
  const htmlStack: HtmlMark[] = []
  let colors: BlockColors = {}

  const pushText = (target: Inline[], text: string, styles: Styles): void => {
    if (text === '') return
    const merged: Styles = { ...styles }
    for (const mark of htmlStack) Object.assign(merged, mark.styles)
    const clean = cleanStyles(merged)
    const last = target[target.length - 1]
    if (last && last.type === 'text' && sameStyles(last.styles, clean)) last.text += text
    else target.push({ type: 'text', text, styles: clean })
  }

  const walk = (list: PhrasingContent[], styles: Styles, target: Inline[]): void => {
    for (const node of list) {
      switch (node.type) {
        case 'text':
          pushText(target, node.value, styles)
          break
        case 'break':
          pushText(target, '\n', styles)
          break
        case 'strong':
          walk(node.children, { ...styles, bold: true }, target)
          break
        case 'emphasis':
          walk(node.children, { ...styles, italic: true }, target)
          break
        case 'delete':
          walk(node.children, { ...styles, strike: true }, target)
          break
        case 'inlineCode':
          target.push({ type: 'text', text: node.value, styles: { code: true } })
          break
        case 'inlineMath':
          target.push({ type: 'inlineMath', props: { latex: node.value } })
          break
        case 'link': {
          if (node.title === 'mention') {
            const inner: Inline[] = []
            walk(node.children, {}, inner)
            const title = inner.map((i) => (i.type === 'text' ? i.text : '')).join('')
            target.push({ type: 'pageMention', props: { href: node.url, title } })
            break
          }
          const link: LinkInline = { type: 'link', href: node.url, content: [] }
          const inner: Inline[] = []
          walk(node.children, styles, inner)
          link.content = linkText(inner.filter((i): i is StyledText => i.type === 'text'))
          target.push(link)
          break
        }
        case 'image':
          target.push({
            type: 'link',
            href: node.url,
            content: [{ type: 'text', text: node.alt || node.url, styles: cleanStyles(styles) }]
          })
          break
        case 'html': {
          const value = node.value
          const blockColors = parseBlockColorComment(value)
          if (blockColors) {
            colors = { ...colors, ...blockColors }
          } else if (/^<u>$/i.test(value)) {
            htmlStack.push({ tag: 'u', styles: { underline: true } })
          } else if (/^<\/u>$/i.test(value)) {
            popMark(htmlStack, 'u')
          } else if (/^<span\b[^>]*>$/i.test(value)) {
            const attrs = parseAttrs(value)
            const markStyles: Styles = {}
            if (attrs['data-color']) markStyles.textColor = attrs['data-color']
            if (attrs['data-bg']) markStyles.backgroundColor = attrs['data-bg']
            htmlStack.push({ tag: 'span', styles: markStyles })
          } else if (/^<\/span>$/i.test(value)) {
            popMark(htmlStack, 'span')
          } else if (/^<br\s*\/?>$/i.test(value)) {
            pushText(target, '\n', styles)
          } else {
            pushText(target, value, styles)
          }
          break
        }
        default:
          // footnoteReference, linkReference, imageReference: keep their source-ish text
          if ('value' in node && typeof node.value === 'string')
            pushText(target, node.value, styles)
          else if ('children' in node) walk(node.children as PhrasingContent[], styles, target)
      }
    }
  }

  walk(nodes, {}, out)
  return { content: out, colors }
}

function popMark(stack: HtmlMark[], tag: HtmlMark['tag']): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].tag === tag) {
      stack.splice(i, 1)
      return
    }
  }
}

/** BlockNote's code mark excludes every other mark, links included, so link text cannot be code. */
export function linkText(content: StyledText[]): StyledText[] {
  const out: StyledText[] = []
  for (const item of content) {
    const styles = item.styles.code ? {} : cleanStyles(item.styles)
    const last = out[out.length - 1]
    if (last && sameStyles(last.styles, styles)) last.text += item.text
    else out.push({ type: 'text', text: item.text, styles })
  }
  return out
}

export function cleanStyles(styles: Styles): Styles {
  if (styles.code) return { code: true }
  const out: Styles = {}
  if (styles.bold) out.bold = true
  if (styles.italic) out.italic = true
  if (styles.underline) out.underline = true
  if (styles.strike) out.strike = true
  if (isColor(styles.textColor)) out.textColor = styles.textColor
  if (isColor(styles.backgroundColor)) out.backgroundColor = styles.backgroundColor
  return out
}

export function sameStyles(a: Styles, b: Styles): boolean {
  const ca = cleanStyles(a)
  const cb = cleanStyles(b)
  const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]) as Set<keyof Styles>
  for (const k of keys) if (ca[k] !== cb[k]) return false
  return true
}

// ---------- inline content -> Markdown ----------

type Mark =
  | { kind: 'bold' }
  | { kind: 'italic' }
  | { kind: 'strike' }
  | { kind: 'underline' }
  | { kind: 'textColor'; value: string }
  | { kind: 'backgroundColor'; value: string }

type Segment =
  { kind: 'text'; text: string; marks: Mark[] } | { kind: 'atom'; node: PhrasingContent }

export interface InlineToPhrasingOptions {
  /** Table cells cannot contain line breaks, so newlines become `<br>`. */
  newlineAsHtml?: boolean
  blockColors?: BlockColors
}

export function inlineToPhrasing(
  content: Inline[],
  options: InlineToPhrasingOptions = {}
): PhrasingContent[] {
  const out = segmentsToPhrasing(toSegments(content, options), options)
  const comment = options.blockColors ? renderBlockColorComment(options.blockColors) : null
  if (comment) out.push({ type: 'html', value: comment })
  return out
}

function marksOf(styles: Styles): Mark[] {
  const s = cleanStyles(styles)
  const marks: Mark[] = []
  if (s.bold) marks.push({ kind: 'bold' })
  if (s.italic) marks.push({ kind: 'italic' })
  if (s.strike) marks.push({ kind: 'strike' })
  if (s.underline) marks.push({ kind: 'underline' })
  if (s.textColor) marks.push({ kind: 'textColor', value: s.textColor })
  if (s.backgroundColor) marks.push({ kind: 'backgroundColor', value: s.backgroundColor })
  return marks
}

function toSegments(content: Inline[], options: InlineToPhrasingOptions): Segment[] {
  const segments: Segment[] = []
  for (const item of content) {
    if (item.type === 'inlineMath') {
      segments.push({ kind: 'atom', node: { type: 'inlineMath', value: item.props.latex } })
    } else if (item.type === 'pageMention') {
      segments.push({
        kind: 'atom',
        node: {
          type: 'link',
          url: item.props.href,
          title: 'mention',
          children: [{ type: 'text', value: item.props.title || 'Untitled' }]
        }
      })
    } else if (item.type === 'link') {
      const children = segmentsToPhrasing(toSegments(item.content, options), options)
      segments.push({ kind: 'atom', node: { type: 'link', url: item.href, children } })
    } else if (item.styles.code) {
      segments.push({ kind: 'atom', node: { type: 'inlineCode', value: item.text } })
    } else {
      segments.push({ kind: 'text', text: item.text, marks: marksOf(item.styles) })
    }
  }
  return segments
}

const markKey = (m: Mark): string => ('value' in m ? `${m.kind}:${m.value}` : m.kind)
const hasMark = (seg: Segment, key: string): boolean =>
  seg.kind === 'text' && seg.marks.some((m) => markKey(m) === key)

function segmentsToPhrasing(
  segments: Segment[],
  options: InlineToPhrasingOptions,
  active: Set<string> = new Set()
): PhrasingContent[] {
  const out: PhrasingContent[] = []
  let i = 0
  while (i < segments.length) {
    const seg = segments[i]
    if (seg.kind === 'atom') {
      out.push(seg.node)
      i++
      continue
    }
    const pending = seg.marks.filter((m) => !active.has(markKey(m)))
    if (pending.length === 0) {
      out.push(...textToPhrasing(seg.text, options))
      i++
      continue
    }
    // Open the mark that stays active the longest so the tree nests cleanly.
    let best = pending[0]
    let bestEnd = i + 1
    for (const mark of pending) {
      let end = i + 1
      while (end < segments.length && hasMark(segments[end], markKey(mark))) end++
      if (end > bestEnd) {
        best = mark
        bestEnd = end
      }
    }
    const inner = segmentsToPhrasing(
      segments.slice(i, bestEnd),
      options,
      new Set([...active, markKey(best)])
    )
    out.push(...wrap(best, inner))
    i = bestEnd
  }
  return out
}

function textToPhrasing(text: string, options: InlineToPhrasingOptions): PhrasingContent[] {
  const out: PhrasingContent[] = []
  text.split('\n').forEach((part, index) => {
    if (index > 0)
      out.push(options.newlineAsHtml ? { type: 'html', value: '<br>' } : { type: 'break' })
    if (part !== '') out.push({ type: 'text', value: part })
  })
  return out
}

function wrap(mark: Mark, children: PhrasingContent[]): PhrasingContent[] {
  switch (mark.kind) {
    case 'bold':
      return wrapDelimited('strong', children)
    case 'italic':
      return wrapDelimited('emphasis', children)
    case 'strike':
      return wrapDelimited('delete', children)
    case 'underline':
      return [{ type: 'html', value: '<u>' }, ...children, { type: 'html', value: '</u>' }]
    case 'textColor':
      return [
        { type: 'html', value: `<span data-color="${mark.value}">` },
        ...children,
        { type: 'html', value: '</span>' }
      ]
    case 'backgroundColor':
      return [
        { type: 'html', value: `<span data-bg="${mark.value}">` },
        ...children,
        { type: 'html', value: '</span>' }
      ]
  }
}

// `**foo **` is not bold in CommonMark, so edge whitespace moves outside the delimiters.
function wrapDelimited(
  type: 'strong' | 'emphasis' | 'delete',
  children: PhrasingContent[]
): PhrasingContent[] {
  const inner = [...children]
  let lead = ''
  let trail = ''
  const first = inner[0]
  if (first?.type === 'text') {
    const m = /^\s+/.exec(first.value)
    if (m) {
      lead = m[0]
      inner[0] = { type: 'text', value: first.value.slice(lead.length) }
    }
  }
  const lastIndex = inner.length - 1
  const last = inner[lastIndex]
  if (last?.type === 'text') {
    const m = /\s+$/.exec(last.value)
    if (m) {
      trail = m[0]
      inner[lastIndex] = { type: 'text', value: last.value.slice(0, -trail.length) }
    }
  }
  const content = inner.filter((n) => !(n.type === 'text' && n.value === ''))
  const out: PhrasingContent[] = []
  if (lead) out.push({ type: 'text', value: lead })
  if (content.length) out.push({ type, children: content } as PhrasingContent)
  if (trail) out.push({ type: 'text', value: trail })
  return out
}
