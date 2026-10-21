import { mkdir, readFile, readdir, rename, stat, unlink } from 'node:fs/promises'
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
import { blocksText } from '../../shared/core/text'
import type {
  FileChange,
  HistoryVersion,
  PageDoc,
  PageMetaPatch,
  PageNode,
  SearchHit,
  TrashItem,
  WriteResult
} from '../../shared/types'
import { HistoryStore, type Snapshot, type SnapshotMeta } from '../history/store'
import { SearchIndex } from '../search/index'
import { exists, removeDirIfEmpty, uniqueName, writeFileAtomic } from './fs-utils'
import {
  APP_DIR,
  ROOT_ORDER_KEY,
  STATE_FILE,
  loadState,
  saveState,
  serializeState,
  type WorkspaceState
} from './state'
import { Trash } from './trash'

export const ATTACHMENTS_DIR = 'attachments'
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000
/** A file modified this recently may still be being written by another program. */
export const SETTLE_MS = 1000

interface PageRecord {
  id: string
  title: string
  icon?: string
  path: string
  parentId: string | null
}

/** A page file found while walking the folder. */
interface FoundFile {
  path: string
  parentPath: string | null
  text: string
  stat: string
  mtime: number
  /** Creation time, so the older of two files sharing an id keeps it. */
  born: number
  dataId?: string
}

interface ScanDiff {
  added: string[]
  removed: string[]
  changed: { id: string; oldText: string | undefined; oldPath: string }[]
}

export type WorkspaceEvent = { type: 'tree' } | { type: 'page'; id: string; revision: number }

export interface WorkspaceOptions {
  now?: () => Date
  /** How long a file must go unmodified before the app adds an id line to it. */
  settleMs?: number
}

export class Workspace {
  private pages = new Map<string, PageRecord>()
  /** Last known path of every id ever seen, so links to trashed pages still serialize. */
  private knownPaths = new Map<string, string>()
  /** Last text read or written for each page path; lets renames skip pages that cannot link. */
  private texts = new Map<string, string>()
  /** `mtime:size` of each page file when last read, so rescans skip unchanged files. */
  private stats = new Map<string, string>()
  /** Bumped when content changes other than through `writePage`, so stale editors are refused. */
  private revisions = new Map<string, number>()
  /** Pages whose current text the app wrote this session. */
  private owned = new Set<string>()
  /** Page files this session created for folders that had none; removed again if the folder goes away untouched. */
  private stubs = new Map<string, string | null>()
  private lastSnapshot = new Map<string, number>()
  private listeners = new Set<(event: WorkspaceEvent) => void>()
  private stateText = ''
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private indexing: Promise<void> = Promise.resolve()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly index = new SearchIndex()
  private readonly history: HistoryStore
  private readonly trash: Trash
  private readonly now: () => Date
  private readonly settleMs: number

  private constructor(
    readonly root: string,
    private state: WorkspaceState,
    options: WorkspaceOptions
  ) {
    this.now = options.now ?? (() => new Date())
    this.settleMs = options.settleMs ?? SETTLE_MS
    this.history = new HistoryStore(root, this.now)
    this.trash = new Trash(root, this.now)
  }

  static async open(root: string, options: WorkspaceOptions = {}): Promise<Workspace> {
    // Never recreate a missing folder: it may be on an unmounted drive or have been moved.
    const info = await stat(root).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`Folder not found: ${root}`)
    const ws = new Workspace(root, await loadState(root), options)
    ws.stateText = await readFile(join(root, APP_DIR, STATE_FILE), 'utf8').catch(() => '')
    await ws.scan()
    for (const r of ws.pages.values()) ws.index.setTitle(r.id, r.title)
    return ws
  }

  /** Stops background work; the workspace is not used after this. */
  close(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = null
    this.listeners.clear()
  }

  /** Modified so recently that another program may still be writing it (mtime can lead the clock). */
  private unsettled(mtime: number): boolean {
    return this.settleMs > 0 && Math.abs(Date.now() - mtime) < this.settleMs
  }

  /** Looks at the folder again once files that were still being written have settled. */
  private rescanLater(): void {
    if (this.settleTimer) return
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      void this.run(() => this.rescanChanges()).catch((err) => console.error('Rescan failed', err))
    }, this.settleMs)
  }

  onEvent(listener: (event: WorkspaceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: WorkspaceEvent): void {
    for (const listener of this.listeners) listener(event)
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

  /** Reads a page file, treating text the app has not seen as an external change. */
  private async readCurrent(r: PageRecord): Promise<string> {
    const text = await readFile(this.abs(r.path), 'utf8')
    const known = this.texts.get(r.path)
    if (known !== undefined && known !== text) await this.applyExternal(r, text)
    else this.remember(r.path, text)
    return text
  }

  private async writeText(path: string, text: string): Promise<void> {
    await writeFileAtomic(this.abs(path), text)
    this.remember(path, text)
  }

  /** The `texts` cache changed: the recorded file stat no longer describes it. */
  private remember(path: string, text: string): void {
    this.texts.set(path, text)
    this.stats.delete(path)
  }

  private revision(id: string): number {
    return this.revisions.get(id) ?? 0
  }

  private async persist(): Promise<void> {
    this.stateText = serializeState(this.state)
    await saveState(this.root, this.state)
  }

  // ---------- scanning ----------

  /** Walks the folder and rebuilds the page maps, reusing text of files that did not change. */
  private async scan(): Promise<ScanDiff> {
    const old = { pages: this.pages, texts: this.texts, stats: this.stats }
    const walked: FoundFile[] = []
    await this.walk('', null, walked)
    const oldIdAt = new Map([...old.pages.values()].map((r) => [r.path, r.id]))
    const idOf = new Map<FoundFile, string>()
    const claimed = new Set<string>()
    // A page keeps its id at its known path, so a sync tool's conflicted copy is the one renumbered,
    // and a file whose id line an editor dropped is still the same page.
    for (const f of walked) {
      const known = oldIdAt.get(f.path)
      const id = f.dataId ?? known
      if (id && id === known && !claimed.has(id)) {
        claimed.add(id)
        idOf.set(f, id)
      }
    }
    const unsettled: string[] = []
    const before = new Map<string, string>()
    for (const f of [...walked].sort((a, b) => a.born - b.born)) {
      let id = idOf.get(f)
      if (id === undefined && f.dataId && !claimed.has(f.dataId)) id = f.dataId
      if (id === undefined) id = randomUUID()
      claimed.add(id)
      idOf.set(f, id)
      if (this.stubs.get(f.path) === null) this.stubs.set(f.path, id)
      if (f.dataId === id) continue
      // A file another program is still writing would be cut short by writing the id now.
      if (this.unsettled(f.mtime) && !(this.stubs.has(f.path) && f.text === '')) {
        unsettled.push(f.path)
        continue
      }
      // Only the id is added; the rest of the file is left exactly as the user wrote it.
      before.set(f.path, f.text)
      f.text = insertId(f.text, id)
      await writeFileAtomic(this.abs(f.path), f.text)
      f.stat = (await fileStat(this.abs(f.path))).key
    }
    // Unsettled new pages (and their sub-pages) wait; known ones keep their id in memory meanwhile.
    const waiting = unsettled.filter((path) => !oldIdAt.has(path))
    const found = walked.filter(
      (f) => !waiting.some((w) => f.path === w || f.path.startsWith(childDirOf(w) + '/'))
    )
    if (unsettled.length) this.rescanLater()

    const pages = new Map<string, PageRecord>()
    const texts = new Map<string, string>()
    const stats = new Map<string, string>()
    const idByPath = new Map(found.map((f) => [f.path, idOf.get(f)!]))
    for (const f of found) {
      const id = idOf.get(f)!
      const { data } = splitFrontmatter(f.text)
      const meta = data ? metaFromData(data) : { extra: {} }
      pages.set(id, {
        id,
        title: meta.title ?? stemOf(f.path),
        icon: iconToInternal(f.path, meta.icon),
        path: f.path,
        parentId: f.parentPath === null ? null : (idByPath.get(f.parentPath) ?? null)
      })
      texts.set(f.path, f.text)
      stats.set(f.path, f.stat)
      this.knownPaths.set(id, f.path)
    }

    const diff: ScanDiff = { added: [], removed: [], changed: [] }
    for (const [id, r] of pages) {
      const prev = old.pages.get(id)
      if (!prev) diff.added.push(id)
      else if (
        old.texts.get(prev.path) !== texts.get(r.path) &&
        old.texts.get(prev.path) !== before.get(r.path)
      ) {
        diff.changed.push({ id, oldText: old.texts.get(prev.path), oldPath: prev.path })
      }
    }
    for (const id of old.pages.keys()) if (!pages.has(id)) diff.removed.push(id)
    this.pages = pages
    this.texts = texts
    this.stats = stats
    return diff
  }

  private async walk(dir: string, parentPath: string | null, found: FoundFile[]): Promise<void> {
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
        this.stubs.set(pageFile, null)
        files.add(`${name}.md`)
      }
    }
    for (const file of [...files]) {
      const path = joinPath(dir, file)
      if (!this.stubs.has(path)) continue
      const stem = file.slice(0, -3).toLowerCase()
      if (dirs.some((d) => d.toLowerCase() === stem)) continue
      const text = await readFile(this.abs(path), 'utf8').catch(() => null)
      if (text === null || !this.isOwnStub(path, text)) {
        this.stubs.delete(path)
        continue
      }
      if (
        await unlink(this.abs(path)).then(
          () => true,
          () => false
        )
      ) {
        this.stubs.delete(path)
        files.delete(file)
      }
    }
    for (const file of [...files].sort()) {
      if (file.startsWith('.')) continue
      const path = joinPath(dir, file)
      const info = await fileStat(this.abs(path)).catch(() => null)
      if (info === null) continue
      const cached = this.stats.get(path) === info.key ? this.texts.get(path) : undefined
      const text = cached ?? (await readFile(this.abs(path), 'utf8').catch(() => null))
      if (text === null) continue
      const { data } = splitFrontmatter(text)
      found.push({
        path,
        parentPath,
        text,
        stat: info.key,
        mtime: info.mtime,
        born: info.born,
        dataId: data ? metaFromData(data).id : undefined
      })
      await this.walk(childDirOf(path), path, found)
    }
  }

  /** Indexes every page's text for search in the background; searches wait for it. */
  indexContent(): Promise<void> {
    this.indexing = this.indexAll()
    return this.indexing
  }

  private async indexAll(): Promise<void> {
    let done = 0
    for (const id of [...this.pages.keys()]) {
      const r = this.pages.get(id)
      const text = r && this.texts.get(r.path)
      if (r && text !== undefined) this.indexText(r, text)
      if (++done % 50 === 0) await new Promise((resolve) => setImmediate(resolve))
    }
  }

  private indexText(r: PageRecord, text: string): void {
    this.index.set(r.id, r.title, blocksText(parsePage(text).blocks))
  }

  /** Still exactly what the app wrote for the folder, carrying the id it gave it. */
  private isOwnStub(path: string, text: string): boolean {
    const id = this.stubs.get(path)
    if (id === null) return text === ''
    const { data } = splitFrontmatter(text)
    return isStubText(text) && data !== null && metaFromData(data).id === id
  }

  /** Prunes old history and purges expired trash; runs in the background after opening. */
  async maintain(): Promise<void> {
    await this.history.prune()
    await this.run(async () => {
      for (const entry of await this.trash.expired()) await this.deleteEntry(entry.entry)
    })
  }

  // ---------- external changes ----------

  /** Applies a batch of file events; the disk is the source of truth. */
  reconcile(changes: FileChange[]): Promise<void> {
    return this.run(async () => {
      const byPath = this.pathIndex()
      let structural = false
      let stateChanged = false
      const edited = new Set<string>()
      for (const { kind, path } of changes) {
        if (path === `${APP_DIR}/${STATE_FILE}`) stateChanged = true
        else if (kind === 'add' || kind === 'change') {
          if (!path.toLowerCase().endsWith('.md')) continue
          if (byPath.has(path)) edited.add(path)
          else structural = true
        } else if (kind === 'unlink') {
          if (byPath.has(path)) structural = true
        } else if (kind === 'addDir') {
          const ours = path === ATTACHMENTS_DIR || path === APP_DIR
          if (!ours && !byPath.has(`${path}.md`)) structural = true
        } else if ([...byPath.keys()].some((p) => p === `${path}.md` || p.startsWith(`${path}/`))) {
          structural = true
        }
      }
      if (stateChanged) await this.reloadState()
      if (structural) return this.rescanChanges()
      for (const path of edited) {
        const r = this.pages.get(byPath.get(path)!)
        const text = await readFile(this.abs(path), 'utf8').catch(() => null)
        if (r && text !== null && text !== this.texts.get(path)) await this.applyExternal(r, text)
      }
    })
  }

  private async rescanChanges(): Promise<void> {
    const diff = await this.scan()
    for (const id of diff.added)
      this.indexText(this.pages.get(id)!, this.texts.get(this.pages.get(id)!.path)!)
    for (const id of diff.removed) {
      this.index.remove(id)
      this.owned.delete(id)
    }
    for (const r of this.pages.values()) this.index.setTitle(r.id, r.title)
    for (const { id, oldText, oldPath } of diff.changed) {
      const r = this.pages.get(id)!
      await this.contentChanged(r, oldText, oldPath)
    }
    this.emit({ type: 'tree' })
  }

  private async applyExternal(r: PageRecord, text: string): Promise<void> {
    const oldText = this.texts.get(r.path)
    let current = text
    const { data } = splitFrontmatter(text)
    const meta = data ? metaFromData(data) : { extra: {} as Record<string, unknown> }
    if (data && !meta.id) {
      // An editor dropped the id line; put it back once the file is no longer being written.
      const { mtime } = await fileStat(this.abs(r.path))
      if (this.unsettled(mtime)) this.rescanLater()
      else {
        current = insertId(text, r.id)
        await writeFileAtomic(this.abs(r.path), current)
      }
    }
    this.remember(r.path, current)
    const title = meta.title ?? stemOf(r.path)
    const icon = iconToInternal(r.path, meta.icon)
    const treeChanged = title !== r.title || icon !== r.icon
    r.title = title
    r.icon = icon
    await this.contentChanged(r, oldText, r.path)
    if (treeChanged) this.emit({ type: 'tree' })
  }

  /** Keeps what the app had in history, then tells the renderer the page changed underneath it. */
  private async contentChanged(
    r: PageRecord,
    oldText: string | undefined,
    oldPath: string
  ): Promise<void> {
    // What the user wrote here is always kept; text from elsewhere at most every 10 minutes.
    const now = this.now().getTime()
    const due = now - (this.lastSnapshot.get(r.id) ?? 0) >= SNAPSHOT_INTERVAL_MS
    if (oldText !== undefined && (this.owned.has(r.id) || due)) {
      await this.snapshotQuietly(r.id, oldText, oldPath)
      this.lastSnapshot.set(r.id, now)
    }
    this.owned.delete(r.id)
    const revision = this.revision(r.id) + 1
    this.revisions.set(r.id, revision)
    this.indexText(r, this.texts.get(r.path) ?? '')
    this.emit({ type: 'page', id: r.id, revision })
  }

  private async reloadState(): Promise<void> {
    const text = await readFile(join(this.root, APP_DIR, STATE_FILE), 'utf8').catch(() => '')
    if (text === this.stateText) return
    this.stateText = text
    this.state = await loadState(this.root)
    this.emit({ type: 'tree' })
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

  async search(query: string): Promise<SearchHit[]> {
    await this.indexing
    return this.index.search(query).filter((hit) => this.pages.has(hit.id))
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
      const text = await this.readCurrent(r)
      return { ...this.toDoc(r.path, text), id, title: r.title, revision: this.revision(id) }
    })
  }

  /** A page as the editor sees it, with links resolved against the file at `path`. */
  private toDoc(path: string, text: string, linkIds: Record<string, string> = {}): PageDoc {
    const { meta, blocks, frontmatterError } = parsePage(text)
    const byPath = this.pathIndex()
    for (const [target, id] of Object.entries(linkIds)) {
      if (this.pages.has(id)) byPath.set(target, id)
    }
    return {
      id: meta.id ?? '',
      title: meta.title ?? stemOf(path),
      path,
      meta: this.metaToInternal(path, meta, byPath),
      blocks: mapBlockLinks(blocks, (href) => this.toInternalHref(path, href, byPath)),
      revision: 0,
      ...(frontmatterError ? { frontmatterError } : {})
    }
  }

  /**
   * Saves the editor's blocks. Refused when the page changed underneath the editor since it
   * loaded `revision`, unless `force` (the user chose to keep their version).
   */
  writePage(
    id: string,
    blocks: Block[],
    options: { revision?: number; force?: boolean } = {}
  ): Promise<WriteResult> {
    return this.run(async () => {
      const r = this.pages.get(id)
      const disk = r ? await this.readCurrent(r).catch(() => null) : null
      if (!r || disk === null) {
        await this.saveDraft(id, blocks)
        return { ok: false, reason: 'gone' }
      }
      const revision = this.revision(id)
      if (options.revision !== undefined && options.revision !== revision && !options.force) {
        return { ok: false, reason: 'conflict' }
      }
      const { meta } = parsePage(disk)
      const fileBlocks = mapBlockLinks(blocks, (href) => this.toFileHref(r.path, href))
      await this.writeOwn(r, disk, serializePage({ ...meta, id }, fileBlocks))
      this.index.set(id, r.title, blocksText(blocks))
      return { ok: true, revision }
    })
  }

  /** Keeps edits that cannot go to the page (changed or deleted outside the app) in its history. */
  keepDraft(id: string, blocks: Block[]): Promise<void> {
    return this.run(() => this.saveDraft(id, blocks))
  }

  private async saveDraft(id: string, blocks: Block[]): Promise<void> {
    const r = this.pages.get(id)
    const path = r?.path ?? this.knownPaths.get(id) ?? `${id}.md`
    const base = r ? this.texts.get(r.path) : undefined
    const meta = base ? parsePage(base).meta : { extra: {} }
    const fileBlocks = mapBlockLinks(blocks, (href) => this.toFileHref(path, href))
    await this.snapshot(id, serializePage({ ...meta, id }, fileBlocks), path)
  }

  updateMeta(id: string, patch: PageMetaPatch): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const disk = await this.readCurrent(r)
      const { meta, blocks } = parsePage(disk)
      const next: PageMeta = { ...meta, id }
      if (patch.icon !== undefined)
        next.icon = patch.icon ? this.metaHrefToFile(r.path, patch.icon) : undefined
      if (patch.cover !== undefined)
        next.cover = patch.cover ? this.toFileHref(r.path, patch.cover) : undefined
      if (patch.coverPosition !== undefined) next.coverPosition = patch.coverPosition ?? undefined
      if (patch.fullWidth !== undefined) next.fullWidth = patch.fullWidth
      await this.writeOwn(r, disk, serializePage(next, blocks))
      if (patch.icon !== undefined) r.icon = patch.icon ?? undefined
    })
  }

  /** Writes content the user made, keeping history: the text it replaces and a periodic copy. */
  private async writeOwn(r: PageRecord, disk: string, text: string): Promise<void> {
    const now = this.now().getTime()
    if (!this.owned.has(r.id)) {
      // Text the app did not write may exist nowhere else, so it is never replaced without a copy.
      await this.snapshot(r.id, disk, r.path)
      this.owned.add(r.id)
      this.lastSnapshot.set(r.id, now)
    }
    this.stubs.delete(r.path)
    await this.writeText(r.path, text)
    if (now - (this.lastSnapshot.get(r.id) ?? 0) >= SNAPSHOT_INTERVAL_MS) {
      await this.snapshotQuietly(r.id, text, r.path)
      this.lastSnapshot.set(r.id, now)
    }
  }

  /** Rewrites links or the title field, keeping the text first if the app has not written it yet. */
  private async rewrite(r: PageRecord, disk: string, text: string): Promise<void> {
    if (!this.owned.has(r.id)) {
      await this.snapshotQuietly(r.id, disk, r.path)
      this.owned.add(r.id)
      this.lastSnapshot.set(r.id, this.now().getTime())
    }
    await this.writeText(r.path, text)
  }

  // ---------- history ----------

  /** For a copy that may be the only one left; fails when it cannot be saved. */
  private async snapshot(id: string, text: string, path: string): Promise<void> {
    // An empty page has nothing worth restoring.
    if (splitFrontmatter(text).body.trim() === '') return
    try {
      await this.history.save(id, text, this.snapshotMeta(path, text))
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message
      throw new Error(`couldn't keep a copy in its history (${reason})`, { cause: err })
    }
  }

  /** For checkpoints and copies whose loss loses no content: a failure is only logged. */
  private async snapshotQuietly(id: string, text: string, path: string): Promise<void> {
    try {
      await this.snapshot(id, text, path)
    } catch (err) {
      console.error(`Could not save history for ${path}`, err)
    }
  }

  private snapshotMeta(path: string, text: string): SnapshotMeta {
    return { path, links: this.linkIds(path, text, this.pathIndex()) }
  }

  /** The id of every page the file at `path` links to, by the workspace path it links with. */
  private linkIds(path: string, text: string, byPath: Map<string, string>): Record<string, string> {
    const links: Record<string, string> = {}
    const { meta, blocks } = parsePage(text)
    const note = (href: string): string => {
      if (!isExternalHref(href)) {
        const target = resolveHref(path, href)
        const id = byPath.get(target)
        if (id) links[target] = id
      }
      return href
    }
    mapBlockLinks(blocks, note)
    if (meta.cover) note(meta.cover)
    return links
  }

  /** Saves what the user wrote, if it is not in history yet (leaving a page, quitting). */
  checkpoint(id?: string): Promise<void> {
    return this.run(async () => {
      for (const pageId of id ? [id] : [...this.owned]) {
        const r = this.pages.get(pageId)
        const text = r && this.texts.get(r.path)
        if (!r || text === undefined || !this.owned.has(pageId)) continue
        await this.snapshotQuietly(pageId, text, r.path)
        this.lastSnapshot.set(pageId, this.now().getTime())
      }
    })
  }

  /** Newest first; the newest is always what is on disk now, even if another app wrote it. */
  listHistory(id: string): Promise<HistoryVersion[]> {
    return this.run(async () => {
      const r = this.record(id)
      const text = await this.readCurrent(r)
      await this.history.save(id, text, this.snapshotMeta(r.path, text))
      return this.history.list(id)
    })
  }

  readHistory(id: string, version: string): Promise<PageDoc> {
    return this.run(async () => {
      const r = this.record(id)
      const doc = this.snapshotDoc(r, await this.history.read(id, version))
      return { ...doc, revision: this.revision(id) }
    })
  }

  private snapshotDoc(r: PageRecord, snap: Snapshot): PageDoc {
    const doc = this.toDoc(snap.meta.path || r.path, snap.text, snap.meta.links)
    return { ...doc, id: r.id, title: r.title, path: r.path }
  }

  /** Replaces content, icon and cover with a snapshot's; title and location stay. */
  restoreHistory(id: string, version: string): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const doc = this.snapshotDoc(r, await this.history.read(id, version))
      const disk = await this.readCurrent(r)
      const { meta: current } = parsePage(disk)
      await this.snapshot(id, disk, r.path)
      this.owned.add(id)
      const meta: PageMeta = {
        ...doc.meta,
        id,
        title: current.title,
        icon: doc.meta.icon ? this.metaHrefToFile(r.path, doc.meta.icon) : undefined,
        cover: doc.meta.cover ? this.toFileHref(r.path, doc.meta.cover) : undefined
      }
      const fileBlocks = mapBlockLinks(doc.blocks, (href) => this.toFileHref(r.path, href))
      await this.writeText(r.path, serializePage(meta, fileBlocks))
      r.icon = doc.meta.icon
      const revision = this.revision(id) + 1
      this.revisions.set(id, revision)
      this.index.set(id, r.title, blocksText(doc.blocks))
      this.emit({ type: 'page', id, revision })
    })
  }

  // ---------- structure changes ----------

  /** New pages start with an empty title (shown as an "Untitled" placeholder), like Notion. */
  createPage(
    parentId: string | null,
    index?: number,
    content: { title: string; blocks: Block[] } = { title: '', blocks: [] }
  ): Promise<PageNode> {
    return this.run(async () => {
      const parent = parentId ? this.record(parentId) : null
      const dir = parent ? childDirOf(parent.path) : ''
      await mkdir(this.abs(dir), { recursive: true })
      const { title, blocks } = content
      const stem = await this.pageStem(dir, title)
      const path = joinPath(dir, `${stem}.md`)
      const id = randomUUID()
      const meta: PageMeta = { id, extra: {}, ...(stem !== title ? { title } : {}) }
      const fileBlocks = mapBlockLinks(blocks, (href) => this.toFileHref(path, href))
      await this.writeText(path, serializePage(meta, fileBlocks))
      const record: PageRecord = { id, title, path, parentId }
      this.pages.set(id, record)
      this.knownPaths.set(id, path)
      this.index.set(id, title, blocksText(blocks))
      this.insertOrder(parentId, id, index)
      await this.persist()
      return { id, title, path, children: [] }
    })
  }

  /** Copies a page and its sub-pages next to it; links inside the copy point to the copies. */
  duplicatePage(id: string): Promise<PageNode> {
    return this.run(async () => {
      const source = this.record(id)
      const subtree = [source, ...this.descendantsOf(id)]
      const dir = dirOf(source.path)
      const title = `${source.title || 'Untitled'} (1)`
      const stem = await this.pageStem(dir, title)
      const rootPath = joinPath(dir, `${stem}.md`)
      const newIds = new Map(subtree.map((r) => [r.id, randomUUID()]))
      const copies = subtree.map((r): PageRecord & { from: PageRecord } => ({
        from: r,
        id: newIds.get(r.id)!,
        title: r === source ? title : r.title,
        icon: r.icon,
        path:
          r === source
            ? rootPath
            : childDirOf(rootPath) + r.path.slice(childDirOf(source.path).length),
        parentId: r === source ? source.parentId : newIds.get(r.parentId!)!
      }))
      for (const c of copies) {
        this.pages.set(c.id, {
          id: c.id,
          title: c.title,
          icon: c.icon,
          path: c.path,
          parentId: c.parentId
        })
        this.knownPaths.set(c.id, c.path)
      }
      const remap = (href: string): string => {
        const pageId = pageIdFromHref(href)
        const copy = pageId && newIds.get(pageId)
        return copy ? pageLinkHref(copy) : href
      }
      for (const c of copies) {
        const doc = this.toDoc(c.from.path, await this.readCurrent(c.from))
        const meta: PageMeta = {
          ...doc.meta,
          id: c.id,
          title: stemOf(c.path) === c.title ? undefined : c.title,
          icon: doc.meta.icon ? this.metaHrefToFile(c.path, doc.meta.icon) : undefined,
          cover: doc.meta.cover ? this.toFileHref(c.path, doc.meta.cover) : undefined
        }
        const blocks = mapBlockLinks(doc.blocks, remap)
        await mkdir(this.abs(dirOf(c.path)), { recursive: true })
        const fileBlocks = mapBlockLinks(blocks, (href) => this.toFileHref(c.path, href))
        await this.writeText(c.path, serializePage(meta, fileBlocks))
        this.index.set(c.id, c.title, blocksText(blocks))
        const order = this.state.order[c.from.id]
        if (order) this.state.order[c.id] = order.map((child) => newIds.get(child) ?? child)
      }
      const siblings = this.childrenOf(source.parentId).filter((r) => r.id !== copies[0].id)
      this.insertOrder(source.parentId, copies[0].id, siblings.indexOf(source) + 1)
      await this.persist()
      return this.nodeOf(copies[0].id)
    })
  }

  private nodeOf(id: string): PageNode {
    const find = (nodes: PageNode[]): PageNode | null => {
      for (const n of nodes) {
        if (n.id === id) return n
        const hit = find(n.children)
        if (hit) return hit
      }
      return null
    }
    return find(this.tree())!
  }

  renamePage(id: string, title: string): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const dir = dirOf(r.path)
      const stem = await this.pageStem(dir, title, stemOf(r.path))
      await this.relocate(r, dir, stem)
      r.title = title
      this.index.setTitle(id, title)
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
      await this.persist()
    })
  }

  // ---------- trash ----------

  trashPage(id: string): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const removed = [r, ...this.descendantsOf(id)]
      const byPath = this.pathIndex()
      const links: Record<string, string> = {}
      for (const d of removed) {
        const text = this.texts.get(d.path) ?? ''
        Object.assign(links, this.linkIds(d.path, text, byPath))
      }
      await this.trash.add({
        id,
        title: r.title,
        originalPath: r.path,
        parentId: r.parentId,
        index: this.childrenOf(r.parentId).indexOf(r),
        favorites: this.state.favorites.filter((f) => removed.some((d) => d.id === f)),
        links
      })
      for (const d of removed) {
        this.stubs.delete(d.path)
        this.pages.delete(d.id)
        this.texts.delete(d.path)
        this.stats.delete(d.path)
        this.index.remove(d.id)
        this.owned.delete(d.id)
      }
      this.removeOrder(r.parentId, id)
      this.state.favorites = this.state.favorites.filter((f) => this.pages.has(f))
      await removeDirIfEmpty(this.abs(dirOf(r.path)))
      await this.persist()
    })
  }

  listTrash(): Promise<TrashItem[]> {
    return this.run(async () => {
      const items: TrashItem[] = []
      for (const e of await this.trash.list()) {
        const text = await readFile(e.file, 'utf8').catch(() => '')
        const { data } = splitFrontmatter(text)
        const parent = e.meta.parentId ? this.pages.get(e.meta.parentId) : undefined
        items.push({
          entry: e.entry,
          pageId: e.meta.id,
          title: e.meta.title,
          icon: iconToInternal(e.meta.originalPath, data ? metaFromData(data).icon : undefined),
          parentTitle: parent ? parent.title || 'Untitled' : null,
          deletedAt: e.meta.deletedAt,
          pageCount: await this.trash.countPages(e)
        })
      }
      return items
    })
  }

  readTrash(entry: string): Promise<PageDoc> {
    return this.run(async () => {
      const e = await this.trash.get(entry)
      // An entry whose page file was lost still holds its sub-pages.
      const text = await readFile(e.file, 'utf8').catch(() => '')
      const doc = this.toDoc(e.meta.originalPath, text)
      return { ...doc, id: e.meta.id, title: e.meta.title }
    })
  }

  /** Puts a page back where it was, or at the top level if its parent is gone. */
  restoreTrash(entry: string): Promise<string> {
    return this.run(async () => {
      const e = await this.trash.get(entry)
      const parent = e.meta.parentId ? (this.pages.get(e.meta.parentId) ?? null) : null
      const dir = parent ? childDirOf(parent.path) : ''
      await mkdir(this.abs(dir), { recursive: true })
      const stem = await this.pageStem(dir, e.meta.title)
      const path = joinPath(dir, `${stem}.md`)
      if (await exists(e.file)) await rename(e.file, this.abs(path))
      if (await exists(e.folder)) await rename(e.folder, this.abs(childDirOf(path)))
      await this.trash.remove(e)
      await this.rescanChanges()
      // Found by path: if a live page holds the same id, the scan gave this one a new id.
      const r = this.record(this.pathIndex().get(path)!)
      const restored = [r, ...this.descendantsOf(r.id)]
      const moved = new Map<string, string>()
      if (path !== e.meta.originalPath) {
        moved.set(e.meta.originalPath, path)
        const oldChildDir = childDirOf(e.meta.originalPath)
        for (const d of restored.slice(1)) {
          moved.set(oldChildDir + d.path.slice(childDirOf(path).length), d.path)
        }
      }
      await this.relinkRestored(restored, moved, e.meta.links ?? {})
      r.title = e.meta.title
      this.index.setTitle(r.id, r.title)
      await this.syncTitleField(r)
      const sameParent = (parent?.id ?? null) === e.meta.parentId
      this.insertOrder(parent?.id ?? null, r.id, sameParent ? e.meta.index : undefined)
      for (const d of restored) {
        const was = d === r ? e.meta.id : d.id
        const favorite = e.meta.favorites?.includes(was) && !this.state.favorites.includes(d.id)
        if (favorite) this.state.favorites.push(d.id)
      }
      await this.persist()
      return r.id
    })
  }

  deleteTrash(entry: string): Promise<void> {
    return this.run(() => this.deleteEntry(entry))
  }

  private async deleteEntry(entry: string): Promise<void> {
    const e = await this.trash.get(entry)
    // A live page can share an id with a trashed one (a sync tool recreated it); its history stays.
    const ids = (await this.trash.pageIds(e)).filter((id) => !this.pages.has(id))
    await this.history.remove(ids)
    await this.trash.remove(e)
  }

  setFavorite(id: string, favorite: boolean): Promise<void> {
    return this.run(async () => {
      this.record(id)
      const rest = this.state.favorites.filter((f) => f !== id)
      this.state.favorites = favorite ? [...rest, id] : rest
      await this.persist()
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
    const disk = await this.readCurrent(r)
    const { meta, blocks } = parsePage(disk)
    const title = stemOf(r.path) === r.title ? undefined : r.title
    if (meta.title === title) return
    await this.rewrite(r, disk, serializePage({ ...meta, id: r.id, title }, blocks))
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
      this.stats.delete(rec.path)
      this.stubs.delete(rec.path)
      if (text !== undefined) this.remember(next, text)
      rec.path = next
      this.knownPaths.set(rec.id, rec.path)
    }
    await this.rewriteLinks(moved, [stemOf(oldPath)])
  }

  private async rewriteLinks(
    moved: Map<string, string>,
    tokens: string[],
    skip = new Set<string>()
  ): Promise<void> {
    const newToOld = new Map([...moved].map(([o, n]) => [n, o]))
    const needles = tokens.flatMap((t) => [t, encodeURIComponent(t)])
    for (const rec of this.pages.values()) {
      if (skip.has(rec.id)) continue
      const cached = this.texts.get(rec.path)
      const candidate =
        newToOld.has(rec.path) || cached === undefined || needles.some((n) => cached.includes(n))
      if (!candidate) continue
      await this.relink(rec, newToOld.get(rec.path) ?? rec.path, (t) => moved.get(t) ?? t)
    }
  }

  /** After a restore: the restored pages' own links, then links elsewhere to their old paths. */
  private async relinkRestored(
    restored: PageRecord[],
    moved: Map<string, string>,
    linkIds: Record<string, string>
  ): Promise<void> {
    const newToOld = new Map([...moved].map(([o, n]) => [n, o]))
    for (const rec of restored) {
      // Through ids, so targets renamed while this page was in Trash are still found.
      await this.relink(rec, newToOld.get(rec.path) ?? rec.path, (target) => {
        const id = linkIds[target]
        return moved.get(target) ?? (id ? this.pages.get(id)?.path : undefined) ?? target
      })
    }
    // A page created at an old path since the delete keeps the links that now point to it.
    const byPath = this.pathIndex()
    const vacated = new Map([...moved].filter(([oldPath]) => !byPath.has(oldPath)))
    if (vacated.size === 0) return
    const tokens = [...vacated.keys()].map((p) => stemOf(p))
    await this.rewriteLinks(vacated, tokens, new Set(restored.map((r) => r.id)))
  }

  /** Rewrites every link in `rec`, written relative to `oldFile`, to point at `destOf(target)`. */
  private async relink(
    rec: PageRecord,
    oldFile: string,
    destOf: (target: string) => string
  ): Promise<void> {
    const disk = await this.readCurrent(rec)
    const { meta, blocks } = parsePage(disk)
    let changed = false
    const remap = (href: string): string => {
      if (isExternalHref(href)) return href
      const next = relativeHref(rec.path, destOf(resolveHref(oldFile, href)))
      if (decodeHref(next) === decodeHref(href)) return href
      changed = true
      return next
    }
    const nextBlocks = mapBlockLinks(blocks, remap)
    const nextMeta = { ...meta }
    if (meta.cover) nextMeta.cover = remap(meta.cover)
    if (meta.icon?.includes('/')) nextMeta.icon = remap(meta.icon)
    if (changed) await this.rewrite(rec, disk, serializePage(nextMeta, nextBlocks))
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

function isStubText(text: string): boolean {
  const { data, body } = splitFrontmatter(text)
  return data !== null && body.trim() === '' && Object.keys(data).every((k) => k === 'id')
}

async function fileStat(path: string): Promise<{ key: string; mtime: number; born: number }> {
  const s = await stat(path)
  return { key: `${s.mtimeMs}:${s.size}`, mtime: s.mtimeMs, born: s.birthtimeMs }
}
