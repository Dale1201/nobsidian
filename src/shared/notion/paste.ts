import { fromHtml } from 'hast-util-from-html'
import type { Block } from '../core/blocks'
import { attr, findAll, textOf } from './hast'
import { mapNotionFragment } from './html'
import { mapNotionRecords, NOTION_RECORDS_TYPE, type PasteNames } from './records'
import type { MapContext } from './types'

export { NOTION_RECORDS_TYPE }

export interface NotionClipboard {
  records?: string
  html?: string
}

/** Notion's content on a clipboard, or null when it was copied from somewhere else. */
export function readNotionClipboard(
  data: Pick<DataTransfer, 'getData' | 'types'>
): NotionClipboard | null {
  const records = data.types.includes(NOTION_RECORDS_TYPE) ? data.getData(NOTION_RECORDS_TYPE) : ''
  const html = data.types.includes('text/html') ? data.getData('text/html') : ''
  if (records) return { records, html }
  if (html.includes('<!-- notionvc:')) return { html }
  return null
}

/** Notion page ids (32 hex) a paste refers to, so they can be matched to imported pages. */
export function notionPageIds(clipboard: NotionClipboard): string[] {
  const text = `${clipboard.records ?? ''}\n${clipboard.html ?? ''}`
  const ids = new Set<string>()
  for (const m of text.matchAll(
    /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/g
  )) {
    ids.add(m[0].replace(/-/g, ''))
  }
  return [...ids]
}

export function mapNotionPaste(clipboard: NotionClipboard, ctx: MapContext): Block[] {
  const tree = fromHtml(clipboard.html ?? '', { fragment: true })
  const names: PasteNames = { pages: new Map(), text: textOf(tree), blocks: [] }
  for (const a of findAll(tree, (el) => el.tagName === 'a')) {
    const id = /([0-9a-f]{32})(?:[?#]|$)/.exec(attr(a, 'href') ?? '')?.[1]
    if (id) names.pages.set(id, textOf(a).trim())
  }
  const quiet: MapContext = { ...ctx, issue: () => {} }
  if (clipboard.records) {
    names.blocks = mapNotionFragment(tree, quiet)
    const blocks = mapNotionRecords(clipboard.records, ctx, names)
    if (blocks) return blocks
  }
  return mapNotionFragment(tree, ctx)
}
