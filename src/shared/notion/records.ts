import type { Block, BlockColors, Inline, StyledText, Styles } from '../core/blocks'
import { DEFAULT_CALLOUT_ICON } from '../core/blocks'
import { normalizeInline } from '../core/normalize'
import { inlineText } from '../core/text'
import { notionColor } from './colors'
import type { MapContext } from './types'

// Notion's private clipboard format (`text/_notion-blocks-v3-production`): the copied blocks'
// records, each with its type, rich text, format and child ids.

export const NOTION_RECORDS_TYPE = 'text/_notion-blocks-v3-production'

type RichText = [string, Mark[]?][]
type Mark = [string, ...unknown[]]

interface BlockRecord {
  id: string
  type: string
  properties?: Record<string, RichText | undefined>
  format?: Record<string, unknown>
  content?: string[]
}

export interface PasteNames {
  /** Notion page id (32 hex) -> its title, from the `text/html` copy. */
  pages: Map<string, string>
  /** Text of the `text/html` copy, to recover person names. */
  text: string
  /** The `text/html` copy mapped to blocks, for content the records leave out. */
  blocks: Block[]
}

/** The blocks a Notion copy holds, in order; null when the data is not Notion's format. */
export function mapNotionRecords(json: string, ctx: MapContext, names: PasteNames): Block[] | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  const list = (data as { blocks?: unknown }).blocks
  if (!Array.isArray(list)) return null
  const records = new Map<string, BlockRecord>()
  const top: string[] = []
  for (const item of list as {
    blockId?: string
    blockSubtree?: { block?: Record<string, unknown> }
  }[]) {
    if (typeof item.blockId !== 'string') continue
    top.push(item.blockId)
    for (const [id, wrapped] of Object.entries(item.blockSubtree?.block ?? {})) {
      const value = unwrap(wrapped)
      if (value) records.set(id, { ...value, id })
    }
  }
  return new RecordMapper(records, ctx, names).blocks(top)
}

function unwrap(wrapped: unknown): Omit<BlockRecord, 'id'> | null {
  let value = (wrapped as { value?: unknown })?.value
  // Newer record maps nest the record one level deeper.
  if (value && typeof value === 'object' && !('type' in value) && 'value' in value) {
    value = (value as { value: unknown }).value
  }
  return value && typeof value === 'object' && 'type' in value
    ? (value as Omit<BlockRecord, 'id'>)
    : null
}

class RecordMapper {
  constructor(
    private readonly records: Map<string, BlockRecord>,
    private readonly ctx: MapContext,
    private readonly names: PasteNames
  ) {}

  blocks(ids: string[]): Block[] {
    const out: Block[] = []
    for (const [i, id] of ids.entries()) {
      const record = this.records.get(id)
      if (record?.type === 'transclusion_container' && !this.hasContent(record)) {
        out.push(...this.syncedFromHtml(this.records.get(ids[i - 1]), this.records.get(ids[i + 1])))
        continue
      }
      out.push(...(record ? this.block(record) : this.pageReference(id)))
    }
    return out
  }

  private hasContent(r: BlockRecord): boolean {
    return (r.content ?? []).every((id) => this.records.has(id))
  }

  /**
   * A copied synced block carries only its container; its content is in the `text/html` copy,
   * between the blocks around it.
   */
  private syncedFromHtml(before?: BlockRecord, after?: BlockRecord): Block[] {
    const html = this.names.blocks
    const own = (b: Block): string =>
      'content' in b && Array.isArray(b.content) ? inlineText(b.content as Inline[]).trim() : ''
    const textOf = (r?: BlockRecord): string | null =>
      r ? inlineText(this.text(r)).trim() || null : null
    const prev = textOf(before)
    const next = textOf(after)
    const start = prev === null ? 0 : html.findIndex((b) => own(b) === prev) + 1
    const end =
      next === null ? html.length : html.findIndex((b, i) => i >= start && own(b) === next)
    if (start <= 0 && prev !== null) return this.lostSynced()
    if (end < start) return this.lostSynced()
    return html.slice(start, end)
  }

  private lostSynced(): Block[] {
    this.ctx.issue('skipped', 'Synced block (copy it from the original block)')
    return []
  }

  private children(r: BlockRecord): Block[] {
    return this.blocks(r.content ?? [])
  }

  private text(r: BlockRecord, key = 'title'): Inline[] {
    return this.richText(r.properties?.[key])
  }

  private plain(r: BlockRecord, key: string): string {
    return (r.properties?.[key] ?? []).map((seg) => seg[0]).join('')
  }

  private colors(r: BlockRecord): BlockColors {
    return notionColor(r.format?.block_color as string | undefined)
  }

  private block(r: BlockRecord): Block[] {
    const colors = this.colors(r)
    const children = (): Block[] => this.children(r)
    switch (r.type) {
      case 'text':
        return [{ type: 'paragraph', props: colors, content: this.text(r), children: children() }]
      case 'header':
      case 'sub_header':
      case 'sub_sub_header':
      case 'header_4': {
        const level = { header: 1, sub_header: 2, sub_sub_header: 3, header_4: 4 }[r.type]
        const toggle = r.format?.toggleable === true
        return [
          {
            type: 'heading',
            props: { level, ...colors, ...(toggle ? { isToggleable: true } : {}) },
            content: this.text(r),
            children: children()
          }
        ]
      }
      case 'bulleted_list':
        return [
          { type: 'bulletListItem', props: colors, content: this.text(r), children: children() }
        ]
      case 'numbered_list':
        return [
          { type: 'numberedListItem', props: colors, content: this.text(r), children: children() }
        ]
      case 'to_do':
        return [
          {
            type: 'checkListItem',
            props: { checked: this.plain(r, 'checked') === 'Yes', ...colors },
            content: this.text(r),
            children: children()
          }
        ]
      case 'toggle':
        return [
          { type: 'toggleListItem', props: colors, content: this.text(r), children: children() }
        ]
      case 'quote':
        return [{ type: 'quote', props: colors, content: this.text(r), children: children() }]
      case 'callout':
        return [this.callout(r, colors)]
      case 'divider':
        return [{ type: 'divider', props: {}, children: [] }]
      case 'code': {
        const text = this.plain(r, 'title')
        const language = this.plain(r, 'language').toLowerCase().replace(/ /g, '') || 'text'
        return [
          {
            type: 'codeBlock',
            props: { language: language === 'plaintext' ? 'text' : language },
            content: text ? [{ type: 'text', text, styles: {} }] : [],
            children: []
          }
        ]
      }
      case 'equation':
        return [{ type: 'math', props: { latex: this.plain(r, 'title') }, children: [] }]
      case 'table':
        return [this.table(r)]
      case 'column_list':
        return [{ type: 'columnList', props: {}, children: this.columns(r) }]
      case 'column':
        return children()
      case 'image':
      case 'video':
      case 'audio':
      case 'file':
      case 'pdf':
        return [this.media(r)]
      case 'bookmark':
        return [this.linkParagraph(this.plain(r, 'link'), this.plain(r, 'title'))]
      case 'embed':
      case 'figma':
      case 'tweet':
      case 'maps':
      case 'codepen':
      case 'gist':
        return [this.linkParagraph(this.plain(r, 'source'), '')]
      case 'table_of_contents':
        return [{ type: 'toc', props: {}, children: [] }]
      case 'transclusion_container':
        return children()
      case 'page':
      case 'collection_view_page':
      case 'collection_view':
        return this.pageReference(r.id, this.plain(r, 'title'))
      case 'alias': {
        const target = (r.format?.alias_pointer as { id?: string } | undefined)?.id
        return target ? this.pageReference(target) : []
      }
      default: {
        const text = this.text(r)
        if (text.length === 0 && (r.content ?? []).length === 0) {
          this.ctx.issue('skipped', r.type)
          return []
        }
        this.ctx.issue('unknown', r.type)
        return [{ type: 'paragraph', props: {}, content: text, children: children() }]
      }
    }
  }

  private callout(r: BlockRecord, colors: BlockColors): Block {
    const icon = typeof r.format?.page_icon === 'string' ? r.format.page_icon : DEFAULT_CALLOUT_ICON
    let content = this.text(r)
    let kids = this.children(r)
    // Newer callouts keep their text in a first child paragraph.
    const lead = kids[0]
    if (
      content.length === 0 &&
      lead?.type === 'paragraph' &&
      Object.keys(lead.props).length === 0
    ) {
      content = lead.content
      kids = [...lead.children, ...kids.slice(1)]
    }
    const background =
      colors.backgroundColor || colors.textColor ? colors : { backgroundColor: 'gray' }
    return { type: 'callout', props: { icon, ...background }, content, children: kids }
  }

  private columns(r: BlockRecord): Block[] {
    const columns = (r.content ?? []).map((id) => this.records.get(id)).filter((c) => !!c)
    return columns.map((c) => {
      const ratio = Number(c.format?.column_ratio)
      const width = ratio > 0 ? Math.round(ratio * columns.length * 1000) / 1000 : 1
      return { type: 'column', props: { width }, children: this.children(c) }
    })
  }

  private table(r: BlockRecord): Block {
    const order = (r.format?.table_block_column_order as string[] | undefined) ?? []
    const rows = (r.content ?? [])
      .map((id) => this.records.get(id))
      .filter((row): row is BlockRecord => row?.type === 'table_row')
    if (r.format?.table_block_row_header === true) {
      this.ctx.issue('table', 'Header column (kept as a normal column)')
    }
    return {
      type: 'table',
      props: {},
      content: {
        type: 'tableContent',
        rows: rows.map((row) => ({ cells: order.map((col) => this.text(row, col)) }))
      },
      children: []
    }
  }

  private media(r: BlockRecord): Block {
    const source = this.plain(r, 'source')
    const caption = this.plain(r, 'caption')
    const name = this.plain(r, 'title') || source.split('/').pop() || 'file'
    if (!/^https?:/i.test(source)) {
      // Uploaded files arrive as `attachment:<id>:<name>`; Notion gives no address to fetch.
      const label = r.type === 'image' ? 'Image' : 'File'
      this.ctx.issue('missingFile', name)
      return {
        type: 'paragraph',
        props: {},
        content: [
          { type: 'text', text: `${label} from Notion: ${name}`, styles: { italic: true } }
        ],
        children: []
      }
    }
    const url = this.ctx.file(source)
    if (r.type === 'image') return { type: 'image', props: { url, caption }, children: [] }
    if (r.type === 'video' || r.type === 'audio') {
      return { type: r.type, props: { url, caption }, children: [] }
    }
    return this.linkParagraph(source, name)
  }

  private linkParagraph(href: string, text: string): Block {
    const label: StyledText = { type: 'text', text: text || href, styles: {} }
    return {
      type: 'paragraph',
      props: {},
      content: href ? [{ type: 'link', href: this.ctx.link(href), content: [label] }] : [label],
      children: []
    }
  }

  private pageReference(id: string, title?: string): Block[] {
    const notionId = id.replace(/-/g, '')
    const href = this.ctx.link(`https://www.notion.so/${notionId}`, id)
    const name = title || this.names.pages.get(notionId) || 'Untitled'
    if (href.startsWith('nobsidian://page/'))
      return [{ type: 'pageLink', props: { href }, children: [] }]
    return [this.linkParagraph(href, name)]
  }

  // ---------- rich text ----------

  private richText(rich: RichText | undefined): Inline[] {
    if (!rich) return []
    const out: Inline[] = []
    const people = this.personNames(rich)
    for (const [text, marks = []] of rich) {
      const styles: Styles = {}
      let href: string | null = null
      let replaced: Inline | null = null
      for (const [mark, arg] of marks) {
        switch (mark) {
          case 'b':
            styles.bold = true
            break
          case 'i':
            styles.italic = true
            break
          case '_':
            styles.underline = true
            break
          case 's':
            styles.strike = true
            break
          case 'c':
            styles.code = true
            break
          case 'h':
            Object.assign(styles, notionColor(arg as string))
            break
          case 'a':
            href = this.ctx.link(String(arg))
            break
          case 'e':
            replaced = { type: 'inlineMath', props: { latex: String(arg) } }
            break
          case 'p': {
            const id = String(arg)
            const notionId = id.replace(/-/g, '')
            href = this.ctx.link(`https://www.notion.so/${notionId}`, id)
            replaced = this.styled(this.names.pages.get(notionId) ?? 'Untitled', styles)
            break
          }
          case 'u':
            replaced = this.styled(`@${people.shift() ?? 'Someone'}`, styles)
            break
          case 'd':
            replaced = this.styled(`@${formatDate(arg as NotionDate)}`, styles)
            break
        }
      }
      const item = replaced ?? this.styled(text, styles)
      if (href && item.type === 'text') out.push({ type: 'link', href, content: [item] })
      else out.push(item)
    }
    return normalizeInline(out)
  }

  private styled(text: string, styles: Styles): StyledText {
    return { type: 'text', text, styles: { ...styles } }
  }

  /**
   * Notion's records name people only by id; the `text/html` copy has their names. The rich
   * text around each mention is matched against it to find them.
   */
  private personNames(rich: RichText): string[] {
    if (!rich.some(([, marks = []]) => marks.some(([m]) => m === 'u'))) return []
    const pattern = rich
      .map(([text, marks = []]) => {
        if (marks.some(([m]) => m === 'u')) return '@(.+?)'
        if (marks.some(([m]) => m === 'p' || m === 'd' || m === 'e')) return '.*?'
        return escapeRegExp(text)
      })
      .join('')
    const m = new RegExp(pattern).exec(this.names.text)
    return m ? m.slice(1) : []
  }
}

interface NotionDate {
  start_date?: string
  end_date?: string
  start_time?: string
  end_time?: string
}

function formatDate(date: NotionDate | undefined): string {
  const one = (day?: string, time?: string): string => {
    if (!day) return ''
    const d = new Date(`${day}T00:00:00Z`)
    const text = d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    })
    return time ? `${text} ${time}` : text
  }
  const start = one(date?.start_date, date?.start_time)
  const end = one(date?.end_date, date?.end_time)
  return end ? `${start} → ${end}` : start
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
