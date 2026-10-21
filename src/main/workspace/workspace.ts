import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import type { Block } from '../../shared/core/blocks'
import { mapBlockLinks, pageIdFromHref, pageLinkHref } from '../../shared/core/links'
import {
  insertId,
  parsePage,
  serializePage,
  splitFrontmatter,
  metaFromData,
  type PageMeta
} from '../../shared/core/page'
import {
  childDirOf,
  decodeHref,
  dirOf,
  encodeHref,
  isExternalHref,
  joinPath,
  relativeHref,
  resolveHref,
  sanitizeTitle,
  stemOf
} from '../../shared/core/paths'
import type { PageDoc, PageMetaPatch, PageNode } from '../../shared/types'
import { exists, removeDirIfEmpty, uniqueName, writeFileAtomic } from './fs-utils'
import { APP_DIR, ROOT_ORDER_KEY, loadState, saveState, type WorkspaceState } from './state'

export const ATTACHMENTS_DIR = 'attachments'

interface PageRecord {
  id: string
  title: string
  icon?: string
  path: string
  parentId: string | null
}

export class Workspace {
  private pages = new Map<string, PageRecord>()
  /** Last known path of every id ever seen, so links to trashed pages still serialize. */
  private knownPaths = new Map<string, string>()
  /** Last text read or written for each page path; lets renames skip pages that cannot link. */
  private texts = new Map<string, string>()
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(
    readonly root: string,
    private state: WorkspaceState
  ) {}

  static async open(root: string): Promise<Workspace> {
    // Never recreate a missing folder: it may be on an unmounted drive or have been moved.
    const info = await stat(root).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`Folder not found: ${root}`)
    const ws = new Workspace(root, await loadState(root))
    await ws.scan()
    return ws
  }

  /** Runs mutations one at a time so autosaves never interleave with renames. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => {})
    return next
  }

  private abs(path: string): string {
    return join(this.root, ...path.split('/'))
  }

  private async readText(path: string): Promise<string> {
    const text = await readFile(this.abs(path), 'utf8')
    this.texts.set(path, text)
    return text
  }

  private async writeText(path: string, text: string): Promise<void> {
    await writeFileAtomic(this.abs(path), text)
    this.texts.set(path, text)
  }

  // ---------- scanning ----------

  rescan(): Promise<void> {
    return this.run(() => this.scan())
  }

  private async scan(): Promise<void> {
    this.pages.clear()
    this.texts.clear()
    const seen = new Set<string>()
    await this.scanDir('', null, seen)
  }

  private async scanDir(dir: string, parentId: string | null, seen: Set<string>): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(this.abs(dir), { withFileTypes: true })
    } catch {
      return
    }
    const files = new Set(
      entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md')).map((e) => e.name)
    )
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
    // A folder without a page file becomes a page so its children stay reachable.
    for (const name of dirs) {
      if (dir === '' && name === ATTACHMENTS_DIR) continue
      // macOS volumes are usually case-insensitive: "notes/" belongs to "Notes.md".
      const owned = [...files].some((f) => f.slice(0, -3).toLowerCase() === name.toLowerCase())
      const pageFile = joinPath(dir, `${name}.md`)
      if (!owned && !(await exists(this.abs(pageFile)))) {
        await writeFileAtomic(this.abs(pageFile), '')
        files.add(`${name}.md`)
      }
    }
    for (const file of [...files].sort()) {
      if (file.startsWith('.')) continue
      const path = joinPath(dir, file)
      const record = await this.loadRecord(path, parentId, seen)
      this.pages.set(record.id, record)
      this.knownPaths.set(record.id, record.path)
      await this.scanDir(childDirOf(path), record.id, seen)
    }
  }

  private async loadRecord(
    path: string,
    parentId: string | null,
    seen: Set<string>
  ): Promise<PageRecord> {
    const text = await this.readText(path)
    const { data } = splitFrontmatter(text)
    const meta = data ? metaFromData(data) : { extra: {} }
    let id = meta.id
    if (!id || seen.has(id)) {
      id = randomUUID()
      // Only the id is added; the rest of the file is left exactly as the user wrote it.
      await this.writeText(path, insertId(text, id))
    }
    seen.add(id)
    return {
      id,
      title: meta.title ?? stemOf(path),
      icon: iconToInternal(path, meta.icon),
      path,
      parentId
    }
  }

  // ---------- queries ----------

  tree(): PageNode[] {
    const groups = this.groupChildren()
    const build = (parentId: string | null): PageNode[] =>
      (groups.get(parentId) ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        icon: r.icon,
        path: r.path,
        children: build(r.id)
      }))
    return build(null)
  }

  favorites(): string[] {
    return this.state.favorites.filter((id) => this.pages.has(id))
  }

  /** Every parent's children in sidebar order, built in one pass. */
  private groupChildren(): Map<string | null, PageRecord[]> {
    const groups = new Map<string | null, PageRecord[]>()
    for (const r of this.pages.values()) {
      const list = groups.get(r.parentId)
      if (list) list.push(r)
      else groups.set(r.parentId, [r])
    }
    for (const [parentId, kids] of groups) {
      const order = this.state.order[parentId ?? ROOT_ORDER_KEY] ?? []
      const rank = new Map(order.map((id, i) => [id, i]))
      const at = (r: PageRecord): number => rank.get(r.id) ?? Number.MAX_SAFE_INTEGER
      kids.sort(
        (a, b) => at(a) - at(b) || a.title.localeCompare(b.title, undefined, { numeric: true })
      )
    }
    return groups
  }

  private childrenOf(parentId: string | null): PageRecord[] {
    return this.groupChildren().get(parentId) ?? []
  }

  private record(id: string): PageRecord {
    const r = this.pages.get(id)
    if (!r) throw new Error(`Unknown page ${id}`)
    return r
  }

  private descendantsOf(id: string): PageRecord[] {
    const groups = this.groupChildren()
    const out: PageRecord[] = []
    const walk = (parentId: string): void => {
      for (const child of groups.get(parentId) ?? []) {
        out.push(child)
        walk(child.id)
      }
    }
    walk(id)
    return out
  }

  // ---------- reading and writing ----------

  /** Queued like writes, so a page never loads content that a pending save is replacing. */
  readPage(id: string): Promise<PageDoc> {
    return this.run(async () => {
      const r = this.record(id)
      const { meta, blocks } = parsePage(await this.readText(r.path))
      const byPath = this.pathIndex()
      return {
        id,
        title: r.title,
        path: r.path,
        meta: this.metaToInternal(r.path, meta, byPath),
        blocks: mapBlockLinks(blocks, (href) => this.toInternalHref(r.path, href, byPath))
      }
    })
  }

  writePage(id: string, blocks: Block[]): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const { meta } = parsePage(await this.readText(r.path))
      const fileBlocks = mapBlockLinks(blocks, (href) => this.toFileHref(r.path, href))
      await this.writeText(r.path, serializePage({ ...meta, id }, fileBlocks))
    })
  }

  updateMeta(id: string, patch: PageMetaPatch): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const { meta, blocks } = parsePage(await this.readText(r.path))
      const next: PageMeta = { ...meta, id }
      if (patch.icon !== undefined)
        next.icon = patch.icon ? this.metaHrefToFile(r.path, patch.icon) : undefined
      if (patch.cover !== undefined)
        next.cover = patch.cover ? this.toFileHref(r.path, patch.cover) : undefined
      if (patch.coverPosition !== undefined) next.coverPosition = patch.coverPosition ?? undefined
      if (patch.fullWidth !== undefined) next.fullWidth = patch.fullWidth
      await this.writeText(r.path, serializePage(next, blocks))
      if (patch.icon !== undefined) r.icon = patch.icon ?? undefined
    })
  }

  // ---------- structure changes ----------

  createPage(parentId: string | null, index?: number): Promise<PageNode> {
    return this.run(async () => {
      const parent = parentId ? this.record(parentId) : null
      const dir = parent ? childDirOf(parent.path) : ''
      await mkdir(this.abs(dir), { recursive: true })
      // New pages start with an empty title (shown as an "Untitled" placeholder), like Notion.
      const title = ''
      const stem = await this.pageStem(dir, title)
      const path = joinPath(dir, `${stem}.md`)
      const id = randomUUID()
      const meta: PageMeta = { id, extra: {}, ...(stem !== title ? { title } : {}) }
      await this.writeText(path, serializePage(meta, []))
      const record: PageRecord = { id, title, path, parentId }
      this.pages.set(id, record)
      this.knownPaths.set(id, path)
      this.insertOrder(parentId, id, index)
      await saveState(this.root, this.state)
      return { id, title, path, children: [] }
    })
  }

  renamePage(id: string, title: string): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const dir = dirOf(r.path)
      const stem = await this.pageStem(dir, title, stemOf(r.path))
      await this.relocate(r, dir, stem)
      r.title = title
      await this.syncTitleField(r)
    })
  }

  movePage(id: string, newParentId: string | null, index: number): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      if (
        newParentId === id ||
        (newParentId && this.descendantsOf(id).some((d) => d.id === newParentId))
      ) {
        throw new Error('A page cannot be moved inside itself')
      }
      this.removeOrder(r.parentId, id)
      if (newParentId !== r.parentId) {
        const parent = newParentId ? this.record(newParentId) : null
        const dir = parent ? childDirOf(parent.path) : ''
        await mkdir(this.abs(dir), { recursive: true })
        const oldDir = dirOf(r.path)
        const stem = await this.pageStem(dir, r.title)
        await this.relocate(r, dir, stem)
        r.parentId = newParentId
        await this.syncTitleField(r)
        await removeDirIfEmpty(this.abs(oldDir))
      }
      this.insertOrder(newParentId, id, index)
      await saveState(this.root, this.state)
    })
  }

  trashPage(id: string): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dest = join(this.root, APP_DIR, 'trash', `${stamp}-${id}`)
      await mkdir(dest, { recursive: true })
      const name = basename(r.path)
      await rename(this.abs(r.path), join(dest, name))
      const folder = this.abs(childDirOf(r.path))
      if (await exists(folder)) await rename(folder, join(dest, name.slice(0, -3)))
      await writeFile(
        join(dest, 'meta.json'),
        JSON.stringify(
          {
            id,
            title: r.title,
            originalPath: r.path,
            parentId: r.parentId,
            deletedAt: new Date().toISOString()
          },
          null,
          2
        )
      )
      for (const d of [r, ...this.descendantsOf(id)]) {
        this.pages.delete(d.id)
        this.texts.delete(d.path)
      }
      this.removeOrder(r.parentId, id)
      this.state.favorites = this.state.favorites.filter((f) => this.pages.has(f))
      await removeDirIfEmpty(this.abs(dirOf(r.path)))
      await saveState(this.root, this.state)
    })
  }

  setFavorite(id: string, favorite: boolean): Promise<void> {
    return this.run(async () => {
      this.record(id)
      const rest = this.state.favorites.filter((f) => f !== id)
      this.state.favorites = favorite ? [...rest, id] : rest
      await saveState(this.root, this.state)
    })
  }

  /** Saves bytes under attachments/ and returns the internal href for them. */
  saveAttachment(name: string, data: Uint8Array): Promise<string> {
    return this.run(async () => {
      const dir = this.abs(ATTACHMENTS_DIR)
      await mkdir(dir, { recursive: true })
      const ext = extname(name)
      const base = sanitizeTitle(basename(name, ext)) || 'file'
      const stem = await uniqueName(dir, base, ext)
      await writeFileAtomic(join(dir, stem + ext), data)
      return '/' + encodeHref(`${ATTACHMENTS_DIR}/${stem}${ext}`)
    })
  }

  /** Absolute path for an internal `/…` href, refusing anything outside the workspace. */
  resolveAsset(internalHref: string): string | null {
    const rel = joinPath(decodeHref(internalHref))
    if (rel === '' || rel.startsWith(APP_DIR)) return null
    return this.abs(rel)
  }

  // ---------- moving files and rewriting links ----------

  private pageStem(dir: string, title: string, allow?: string): Promise<string> {
    return uniqueName(this.abs(dir), sanitizeTitle(title), '.md', {
      allow,
      reserved: dir === '' ? [ATTACHMENTS_DIR] : []
    })
  }

  /** Stores the exact title in frontmatter only when the filename cannot carry it. */
  private async syncTitleField(r: PageRecord): Promise<void> {
    const { meta, blocks } = parsePage(await this.readText(r.path))
    const title = stemOf(r.path) === r.title ? undefined : r.title
    if (meta.title === title) return
    await this.writeText(r.path, serializePage({ ...meta, id: r.id, title }, blocks))
  }

  /** Moves a page file (and its child folder) to `dir/stem.md`, then fixes links everywhere. */
  private async relocate(r: PageRecord, dir: string, stem: string): Promise<void> {
    const oldPath = r.path
    const newPath = joinPath(dir, `${stem}.md`)
    if (oldPath === newPath) return
    const moved = new Map<string, string>()
    const oldChildDir = childDirOf(oldPath)
    const newChildDir = childDirOf(newPath)
    moved.set(oldPath, newPath)
    for (const d of this.descendantsOf(r.id)) {
      moved.set(d.path, newChildDir + d.path.slice(oldChildDir.length))
    }
    await rename(this.abs(oldPath), this.abs(newPath))
    if (await exists(this.abs(oldChildDir)))
      await rename(this.abs(oldChildDir), this.abs(newChildDir))
    for (const rec of [r, ...this.descendantsOf(r.id)]) {
      const next = moved.get(rec.path) ?? rec.path
      const text = this.texts.get(rec.path)
      this.texts.delete(rec.path)
      if (text !== undefined) this.texts.set(next, text)
      rec.path = next
      this.knownPaths.set(rec.id, rec.path)
    }
    await this.rewriteLinks(moved, [stemOf(oldPath)])
  }

  private async rewriteLinks(moved: Map<string, string>, tokens: string[]): Promise<void> {
    const newToOld = new Map([...moved].map(([o, n]) => [n, o]))
    const needles = tokens.flatMap((t) => [t, encodeURIComponent(t)])
    for (const rec of this.pages.values()) {
      const oldFile = newToOld.get(rec.path) ?? rec.path
      const cached = this.texts.get(rec.path)
      const candidate =
        newToOld.has(rec.path) || cached === undefined || needles.some((n) => cached.includes(n))
      if (!candidate) continue
      const { meta, blocks } = parsePage(await this.readText(rec.path))
      let changed = false
      const remap = (href: string): string => {
        if (isExternalHref(href)) return href
        const target = resolveHref(oldFile, href)
        const next = relativeHref(rec.path, moved.get(target) ?? target)
        if (decodeHref(next) === decodeHref(href)) return href
        changed = true
        return next
      }
      const nextBlocks = mapBlockLinks(blocks, remap)
      const nextMeta = { ...meta }
      if (meta.cover) nextMeta.cover = remap(meta.cover)
      if (meta.icon?.includes('/')) nextMeta.icon = remap(meta.icon)
      if (changed) await this.writeText(rec.path, serializePage(nextMeta, nextBlocks))
    }
  }

  // ---------- href translation between disk and editor ----------

  private pathIndex(): Map<string, string> {
    return new Map([...this.pages.values()].map((r) => [r.path, r.id]))
  }

  private toInternalHref(pagePath: string, href: string, byPath: Map<string, string>): string {
    if (isExternalHref(href)) return href
    const target = resolveHref(pagePath, href)
    const id = byPath.get(target)
    return id ? pageLinkHref(id) : '/' + encodeHref(target)
  }

  private toFileHref(pagePath: string, href: string): string {
    const pageId = pageIdFromHref(href)
    if (pageId) {
      const target = this.pages.get(pageId)?.path ?? this.knownPaths.get(pageId)
      return target ? relativeHref(pagePath, target) : href
    }
    if (href.startsWith('/') && !href.startsWith('//'))
      return relativeHref(pagePath, decodeHref(href))
    return href
  }

  private metaToInternal(pagePath: string, meta: PageMeta, byPath: Map<string, string>): PageMeta {
    return {
      ...meta,
      icon: iconToInternal(pagePath, meta.icon),
      cover: meta.cover ? this.toInternalHref(pagePath, meta.cover, byPath) : undefined
    }
  }

  private metaHrefToFile(pagePath: string, icon: string): string {
    return icon.startsWith('/') ? this.toFileHref(pagePath, icon) : icon
  }

  // ---------- ordering ----------

  private insertOrder(parentId: string | null, id: string, index?: number): void {
    const key = parentId ?? ROOT_ORDER_KEY
    const current = this.childrenOf(parentId)
      .map((r) => r.id)
      .filter((x) => x !== id)
    const at = index === undefined ? current.length : Math.max(0, Math.min(index, current.length))
    current.splice(at, 0, id)
    this.state.order[key] = current
  }

  private removeOrder(parentId: string | null, id: string): void {
    const key = parentId ?? ROOT_ORDER_KEY
    const list = this.state.order[key]
    if (list) this.state.order[key] = list.filter((x) => x !== id)
  }
}

/** Image icons are kept as workspace paths so they survive the page moving. */
function iconToInternal(pagePath: string, icon: string | undefined): string | undefined {
  if (!icon || !icon.includes('/') || isExternalHref(icon)) return icon
  return '/' + encodeHref(resolveHref(pagePath, icon))
}
