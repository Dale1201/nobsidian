import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'

export const FIXTURE_ZIP = join(__dirname, '../../../tests/fixtures/notion-export.zip')

/** Writes a zip holding `files` (path -> contents); for tests. */
export async function writeZip(
  path: string,
  files: Record<string, string | Buffer>
): Promise<string> {
  const zip = new yazl.ZipFile()
  for (const [name, data] of Object.entries(files)) {
    zip.addBuffer(typeof data === 'string' ? Buffer.from(data) : data, name)
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path))
  return path
}

/** A minimal Notion export page. */
export function notionPage(title: string, body = '', header = ''): string {
  return (
    `<html><body><article class="page sans"><header>${header}<h1 class="page-title">${title}</h1></header>` +
    `<div class="page-body">${body}</div></article></body></html>`
  )
}

export function subPageLink(href: string, id: string, title: string): string {
  return `<figure class="link-to-page"><a href="${encodeURI(href)}" data-notion-page-id="${id}">${title}</a></figure>`
}
