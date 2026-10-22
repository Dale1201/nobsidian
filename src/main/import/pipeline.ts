import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Root } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import type { Block, Inline } from '../../shared/core/blocks'
import { pageLinkHref } from '../../shared/core/links'
import { isExternalHref, resolveHref } from '../../shared/core/paths'
import { attr, findAll, hasClass, textOf } from '../../shared/notion/hast'
import { mapNotionPage } from '../../shared/notion/html'
import type { IssueKind, MapContext } from '../../shared/notion/types'
import type { ImportProgress } from '../../shared/types'
import { downloadImage } from './download'
import { buildTree, exportPages, type ExportPage } from './tree'
import {
  ImportError,
  STAGED_FILE_PREFIX,
  type ImportManifest,
  type StagedFile,
  type StagedIssue,
  type StagedPage
} from './types'
import { openExport, type ExportArchive } from './zip'

export interface ImportOptions {
  zips: string[]
  staging: string
  onProgress?(progress: ImportProgress): void
  /** Downloads an external image; tests replace the network. */
  fetch?: typeof fetch
}

const NOTION_URL = /^https?:\/\/([\w-]+\.)*(notion\.so|notion\.site|notion\.com)\//i

/** Reads a Notion HTML export and stages its pages and files; nothing in the workspace changes. */
export async function runImport(options: ImportOptions): Promise<ImportManifest> {
  const startedAt = Date.now()
  const progress = (p: ImportProgress): void => options.onProgress?.(p)
  progress({ phase: 'reading', done: 0, total: 0 })
  await mkdir(join(options.staging, 'files'), { recursive: true })
  const archive = await openExport(options.zips, options.staging)
  try {
    const paths = [...archive.entries.keys()]
    const pages = exportPages(paths)
    if (pages.length === 0) {
      if (paths.some((p) => / [0-9a-f]{32}\.md$/.test(p))) {
        throw new ImportError('This is a Markdown export. Export again as HTML.')
      }
      throw new ImportError("This zip isn't a Notion HTML export.")
    }
    return await convert(archive, pages, options, startedAt, progress)
  } finally {
    archive.close()
  }
}

async function convert(
  archive: ExportArchive,
  pages: ExportPage[],
  options: ImportOptions,
  startedAt: number,
  progress: (p: ImportProgress) => void
): Promise<ImportManifest> {
  const ids = new Map(pages.map((p) => [p.notionId, randomUUID()]))
  const byPath = new Map(pages.map((p) => [p.path, p.notionId]))
  const issues: StagedIssue[] = []
  const files = new Map<string, PendingFile>()
  const links = new Map<string, string[]>()
  const staged = new Map<string, StagedPage>()

  const fileHref = (pageId: string, source: string, name: string, url?: string): string => {
    let file = files.get(source)
    if (!file) {
      file = { key: String(files.size + 1), name, source, url, pageId }
      files.set(source, file)
    }
    return STAGED_FILE_PREFIX + file.key
  }

  for (const [i, page] of pages.entries()) {
    progress({ phase: 'converting', done: i, total: pages.length })
    const id = ids.get(page.notionId)!
    const issue = (kind: IssueKind, detail: string): void => {
      issues.push({ kind, detail, pageId: id })
    }
    const ctx: MapContext = {
      link: (href, pageId) => {
        const notionId = pageId?.replace(/-/g, '')
        if (notionId && ids.has(notionId)) return pageLinkHref(ids.get(notionId)!)
        if (NOTION_URL.test(href)) {
          const found = /([0-9a-f]{32})(?:[?#]|$)/.exec(href.replace(/-/g, ''))?.[1]
          if (found && ids.has(found)) return pageLinkHref(ids.get(found)!)
          issue('outsideLink', href)
          return href
        }
        if (isExternalHref(href)) return href
        const target = resolveHref(page.path, href)
        const linked = byPath.get(target)
        if (linked) return pageLinkHref(ids.get(linked)!)
        if (archive.entries.has(target)) return fileHref(id, target, exportName(target))
        if (notionId) issue('outsideLink', href)
        return href
      },
      file: (src) => {
        if (/^https?:/i.test(src)) {
          let url: URL
          try {
            url = new URL(src)
          } catch {
            issue('missingFile', src)
            return src
          }
          return fileHref(id, src, urlName(url), src)
        }
        if (/^data:/i.test(src)) return src
        const target = resolveHref(page.path, src)
        if (archive.entries.has(target)) return fileHref(id, target, exportName(target))
        issue('missingFile', target)
        return src
      },
      issue
    }
    let html: string | undefined
    try {
      html = (await archive.entries.get(page.path)!.read()).toString('utf8')
      const root = fromHtml(html)
      links.set(page.notionId, subPageLinks(root))
      const mapped = mapNotionPage(root, ctx)
      const blocks = mapped.properties.length
        ? [propertiesTable(mapped.properties), ...mapped.blocks]
        : mapped.blocks
      staged.set(page.notionId, {
        id,
        notionId: page.notionId,
        parentId: null,
        title: mapped.title || stemOf(page.path),
        icon: mapped.icon
          ? 'emoji' in mapped.icon
            ? mapped.icon.emoji
            : mapped.icon.src
          : undefined,
        cover: mapped.cover,
        blocks
      })
    } catch (error) {
      issue('failedPage', `${page.path}: ${messageOf(error)}`)
      staged.set(page.notionId, {
        id,
        notionId: page.notionId,
        parentId: null,
        title: stemOf(page.path),
        blocks: html === undefined ? [] : plainTextBlocks(html)
      })
    }
  }

  progress({ phase: 'converting', done: pages.length, total: pages.length })
  const { nodes, order } = buildTree(pages, links)
  const groups = [...new Set([...nodes.values()].filter((n) => !n.parent).map((n) => n.group))]
  const groupIds = new Map<string, string>()
  const groupPages: StagedPage[] = []
  if (groups.length > 1) {
    for (const group of groups) {
      const id = randomUUID()
      groupIds.set(group, id)
      groupPages.push({ id, parentId: null, title: group.split('/').pop() || 'Notion', blocks: [] })
    }
  }
  for (const [notionId, node] of nodes) {
    const page = staged.get(notionId)!
    page.parentId = node.parent ? ids.get(node.parent)! : (groupIds.get(node.group) ?? null)
  }
  // Pages in the order Notion shows them: parents before children, siblings in link order.
  const ordered: StagedPage[] = [...groupPages]
  const visit = (parent: string | null): void => {
    for (const notionId of order.get(parent) ?? []) {
      ordered.push(staged.get(notionId)!)
      visit(notionId)
    }
  }
  visit(null)

  const stagedFiles = await stageFiles(archive, [...files.values()], options, issues, progress)
  return {
    pages: ordered,
    files: stagedFiles,
    issues,
    sources: options.zips,
    startedAt
  }
}

/** Notion ids of the sub-pages and database rows a page shows, in order. */
function subPageLinks(root: Root): string[] {
  const out: string[] = []
  const anchors = findAll(root, (el) => {
    if (el.tagName !== 'figure' && el.tagName !== 'td') return false
    return hasClass(el, 'link-to-page') || hasClass(el, 'cell-title')
  }).flatMap((box) => findAll(box, (el) => el.tagName === 'a'))
  for (const a of anchors) {
    const id = attr(a, 'data-notion-page-id')?.replace(/-/g, '')
    const fromHref = /([0-9a-f]{32})\.html$/.exec(safeDecode(attr(a, 'href') ?? ''))?.[1]
    const notionId = id ?? fromHref
    if (notionId) out.push(notionId)
  }
  return out
}

function propertiesTable(properties: { name: string; value: Inline[] }[]): Block {
  return {
    type: 'table',
    props: {},
    content: {
      type: 'tableContent',
      rows: properties.map((p) => ({
        cells: [[{ type: 'text', text: p.name, styles: {} }], p.value]
      }))
    },
    children: []
  }
}

/**
 * A failed page's text as plain paragraphs, one per blank-line-separated run, for a page that
 * cannot be mapped. The header (title and properties) is left out.
 */
export function plainTextBlocks(html: string): Block[] {
  const root = fromHtml(html)
  const body =
    findAll(root, (el) => hasClass(el, 'page-body'))[0] ??
    findAll(root, (el) => el.tagName === 'body')[0] ??
    root
  return textOf(body)
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text): Block => ({
      type: 'paragraph',
      props: {},
      children: [],
      content: [{ type: 'text', text, styles: {} }]
    }))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface PendingFile {
  key: string
  name: string
  /** Its path in the export, or its URL. */
  source: string
  url?: string
  /** The first page that uses it, for the report. */
  pageId: string
}

async function stageFiles(
  archive: ExportArchive,
  files: PendingFile[],
  options: ImportOptions,
  issues: StagedIssue[],
  progress: (p: ImportProgress) => void
): Promise<StagedFile[]> {
  const out: StagedFile[] = []
  for (const [i, file] of files.entries()) {
    progress({ phase: 'copying', done: i, total: files.length })
    const dest = join(options.staging, 'files', file.key + safeExt(file.name))
    try {
      if (file.url) {
        const image = await downloadImage(file.url, options.fetch).catch(() => null)
        if (image) {
          await writeFile(dest, image.data)
          out.push({ key: file.key, name: image.name, path: dest })
        } else {
          issues.push({ kind: 'download', detail: file.url, pageId: file.pageId })
          out.push({ key: file.key, name: file.name, url: file.url })
        }
      } else {
        await archive.entries.get(file.source)!.copyTo(dest)
        out.push({ key: file.key, name: file.name, path: dest })
      }
    } catch {
      issues.push({ kind: 'missingFile', detail: file.source, pageId: file.pageId })
      out.push({ key: file.key, name: file.name })
    }
  }
  progress({ phase: 'copying', done: files.length, total: files.length })
  return out
}

/** The last segment of a path in the export; the path is already decoded. */
function exportName(path: string): string {
  return path.split('/').pop() || 'file'
}

/** The file name in a web address, decoded when it can be. */
function urlName(url: URL): string {
  return safeDecode(url.pathname.split('/').pop() ?? '') || 'file'
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function stemOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/ [0-9a-f]{32}\.html$/, '')
}

function safeExt(name: string): string {
  const ext = extname(name).toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
}
