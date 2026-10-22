import type { Block } from '@shared/core/blocks'
import { pageLinkHref } from '@shared/core/links'
import { mapNotionPaste, notionPageIds, type NotionClipboard } from '@shared/notion/paste'
import type { MapContext } from '@shared/notion/types'

const api = window.api

export interface PastedNotion {
  blocks: Block[]
  /** Images and files uploaded to Notion, which a paste cannot bring over. */
  uploads: number
}

/**
 * Turns a Notion copy into blocks: links to pages imported earlier point at them, and web
 * images are downloaded into attachments/.
 */
export async function prepareNotionPaste(clipboard: NotionClipboard): Promise<PastedNotion> {
  const ids = notionPageIds(clipboard)
  const imported = ids.length
    ? await api
        .invoke('notion:pages', { notionIds: ids })
        .catch(() => ({}) as Record<string, string>)
    : {}
  let uploads = 0
  const ctx: MapContext = {
    link: (href, pageId) => {
      const notionId =
        pageId?.replace(/-/g, '') ?? /([0-9a-f]{32})(?:[?#]|$)/.exec(href.replace(/-/g, ''))?.[1]
      const page = notionId ? imported[notionId] : undefined
      return page ? pageLinkHref(page) : href
    },
    file: (src) => src,
    issue: (kind) => {
      if (kind === 'missingFile') uploads++
    }
  }
  const blocks = await fetchImages(mapNotionPaste(clipboard, ctx))
  return { blocks, uploads }
}

async function fetchImages(blocks: Block[]): Promise<Block[]> {
  return Promise.all(
    blocks.map(async (block): Promise<Block> => {
      const children = await fetchImages(block.children)
      if (block.type !== 'image' || !/^https?:/i.test(block.props.url)) {
        return { ...block, children } as Block
      }
      try {
        const url = await api.invoke('attachment:fetch', { url: block.props.url })
        return { ...block, props: { ...block.props, url }, children }
      } catch {
        // Keep a link to it rather than an image the app is not allowed to load.
        const text = block.props.caption || block.props.url
        return {
          type: 'paragraph',
          props: {},
          content: [
            { type: 'link', href: block.props.url, content: [{ type: 'text', text, styles: {} }] }
          ],
          children
        }
      }
    })
  )
}
