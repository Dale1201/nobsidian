import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { ImportError } from './types'

/** A file inside the export, by its path in the zip, wherever it was nested. */
export interface ExportEntry {
  path: string
  size: number
  read(): Promise<Buffer>
  copyTo(dest: string): Promise<void>
}

export interface ExportArchive {
  entries: Map<string, ExportEntry>
  close(): void
}

/**
 * Opens one or more zips as one export: zips inside them (Notion's `Part-N.zip`) are copied to
 * `tempDir` and opened in turn, and every part's files share one tree of paths.
 */
export async function openExport(zips: string[], tempDir: string): Promise<ExportArchive> {
  const entries = new Map<string, ExportEntry>()
  const open: ZipFile[] = []
  let nested = 0
  const add = async (path: string): Promise<void> => {
    let zip: ZipFile
    try {
      zip = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false })
    } catch {
      throw new ImportError("This file isn't a zip, or it's damaged.")
    }
    open.push(zip)
    for (const entry of await listEntries(zip)) {
      const name = entry.fileName
      if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(name)) {
        continue
      }
      if (/\.zip$/i.test(name)) {
        const copy = join(tempDir, `nested-${++nested}.zip`)
        await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(copy))
        await add(copy)
        continue
      }
      entries.set(name, {
        path: name,
        size: entry.uncompressedSize,
        read: async () => readAll(await zip.openReadStreamPromise(entry)),
        copyTo: async (dest) =>
          pipeline(await zip.openReadStreamPromise(entry), createWriteStream(dest))
      })
    }
  }
  try {
    for (const zip of zips) await add(zip)
  } catch (err) {
    for (const zip of open) zip.close()
    throw err
  }
  return { entries, close: () => open.forEach((zip) => zip.close()) }
}

function listEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const out: Entry[] = []
    zip.on('entry', (entry: Entry) => {
      out.push(entry)
      zip.readEntry()
    })
    zip.once('end', () => resolve(out))
    zip.on('error', () => reject(new ImportError('This zip is damaged.')))
    zip.readEntry()
  })
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

export type ExportKind = 'notion-html' | 'notion-markdown' | 'other'

const NOTION_PAGE = /(^|\/)[^/]* [0-9a-f]{32}\.(html|md)$/
const NOTION_PART = /(^|\/)[^/]*Export[^/]*\.zip$/i

/** What a zip looks like from its file names alone, without extracting anything. */
export async function peekExport(path: string): Promise<ExportKind> {
  let zip: ZipFile
  try {
    zip = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false })
  } catch {
    return 'other'
  }
  try {
    const names = (await listEntries(zip)).map((e) => e.fileName)
    if (names.some((n) => NOTION_PAGE.test(n) && n.endsWith('.html'))) return 'notion-html'
    if (names.some((n) => NOTION_PAGE.test(n))) return 'notion-markdown'
    // Large exports are a zip of part zips; their contents are checked when importing.
    if (names.some((n) => NOTION_PART.test(n))) return 'notion-html'
    return 'other'
  } catch {
    return 'other'
  } finally {
    zip.close()
  }
}
