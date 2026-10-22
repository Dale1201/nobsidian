import type { Block, ImageBlock, ParagraphBlock } from '@shared/core/blocks'
import { pageLinkHref } from '@shared/core/links'
import { mapNotionPaste, notionPageIds, type NotionClipboard } from '@shared/notion/paste'
import type { MapContext } from '@shared/notion/types'

const api = window.api

/** What a downloaded web image's block becomes: the image, or a link to it. */
export type ImageUpdate = Omit<ImageBlock, 'children'> | Omit<ParagraphBlock, 'children'>

/** A web image inserted at its web address, to download and update in place afterwards. */
export interface WebImage {
  /** The id its block is inserted with. */
  id: string
  download(): Promise<ImageUpdate>
}

export interface PastedNotion {
  blocks: Block[]
  images: WebImage[]
  /** Images and files uploaded to Notion, which a paste cannot bring over. */
  uploads: number
}

/**
 * Turns a Notion copy into blocks: links to pages imported earlier point at them. Web images
 * keep their web address; each `images` entry downloads one into attachments/.
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
  const images: WebImage[] = []
  const blocks = withImageIds(mapNotionPaste(clipboard, ctx), images)
  return { blocks, images, uploads }
}

function withImageIds(blocks: Block[], images: WebImage[]): Block[] {
  return blocks.map((block): Block => {
    const children = withImageIds(block.children, images)
    if (block.type !== 'image' || !/^https?:/i.test(block.props.url)) {
      return { ...block, children } as Block
    }
    const id = crypto.randomUUID()
    images.push({ id, download: () => downloadImage(block) })
    return { ...block, id, children }
  })
}

async function downloadImage(block: ImageBlock): Promise<ImageUpdate> {
  try {
    const url = await api.invoke('attachment:fetch', { url: block.props.url })
    return { type: 'image', props: { ...block.props, url } }
  } catch {
    // Keep a link to it rather than an image the app is not allowed to load.
    const text = block.props.caption || block.props.url
    return {
      type: 'paragraph',
      props: {},
      content: [
        { type: 'link', href: block.props.url, content: [{ type: 'text', text, styles: {} }] }
      ]
    }
  }
}
