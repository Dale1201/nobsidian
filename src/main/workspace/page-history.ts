import type { Block } from '../../shared/core/blocks'
import { parsePage, serializePage, splitFrontmatter, type PageMeta } from '../../shared/core/page'
import { blocksText } from '../../shared/core/text'
import type { HistoryVersion, PageDoc } from '../../shared/types'
import { HistoryStore, type Snapshot, type SnapshotMeta } from '../history/store'
import type { PageRecord, WorkspaceCore } from './core'

export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000

/** Decides when a page's text is copied into its history, and restores those copies. */
export class PageHistory {
  readonly store: HistoryStore

  constructor(private readonly core: WorkspaceCore) {
    this.store = new HistoryStore(core.root, core.now)
  }

  /** Writes content the user made, keeping history: the text it replaces and a periodic copy. */
  async writeOwn(r: PageRecord, disk: string, text: string): Promise<void> {
    const core = this.core
    const now = core.now().getTime()
    if (!core.owned.has(r.id)) {
      // Text the app did not write may exist nowhere else, so it is never replaced without a copy.
      await this.snapshot(r.id, disk, r.path)
      core.owned.add(r.id)
      core.lastSnapshot.set(r.id, now)
    }
    core.stubs.delete(r.path)
    await core.writeText(r.path, text)
    if (now - (core.lastSnapshot.get(r.id) ?? 0) >= SNAPSHOT_INTERVAL_MS) {
      await this.snapshotQuietly(r.id, text, r.path)
      core.lastSnapshot.set(r.id, now)
    }
  }

  /** Rewrites links or the title field, keeping the text first if the app has not written it yet. */
  async rewrite(r: PageRecord, disk: string, text: string): Promise<void> {
    const core = this.core
    if (!core.owned.has(r.id)) {
      await this.snapshotQuietly(r.id, disk, r.path)
      core.owned.add(r.id)
      core.lastSnapshot.set(r.id, core.now().getTime())
    }
    await core.writeText(r.path, text)
  }

  /** Keeps edits that cannot go to the page (changed or deleted outside the app) in its history. */
  async saveDraft(id: string, blocks: Block[]): Promise<void> {
    const core = this.core
    const r = core.pages.get(id)
    const path = r?.path ?? core.knownPaths.get(id) ?? `${id}.md`
    const base = r ? core.texts.get(r.path) : undefined
    const meta = base ? parsePage(base).meta : { extra: {} }
    const fileBlocks = core.toFileBlocks(path, blocks)
    await this.snapshot(id, serializePage({ ...meta, id }, fileBlocks), path)
  }

  /** For a copy that may be the only one left; fails when it cannot be saved. */
  async snapshot(id: string, text: string, path: string): Promise<void> {
    // An empty page has nothing worth restoring.
    if (splitFrontmatter(text).body.trim() === '') return
    try {
      await this.store.save(id, text, this.snapshotMeta(path, text))
    } catch (err) {
      const reason = (err as NodeJS.ErrnoException).code ?? (err as Error).message
      throw new Error(`couldn't keep a copy in its history (${reason})`, { cause: err })
    }
  }

  /** For checkpoints and copies whose loss loses no content: a failure is only logged. */
  async snapshotQuietly(id: string, text: string, path: string): Promise<void> {
    try {
      await this.snapshot(id, text, path)
    } catch (err) {
      console.error(`Could not save history for ${path}`, err)
    }
  }

  private snapshotMeta(path: string, text: string): SnapshotMeta {
    return { path, links: this.core.linkIds(path, text, this.core.pathIndex()) }
  }

  /** Saves what the user wrote, if it is not in history yet (leaving a page, quitting). */
  async checkpoint(id?: string): Promise<void> {
    const core = this.core
    for (const pageId of id ? [id] : [...core.owned]) {
      const r = core.pages.get(pageId)
      const text = r && core.texts.get(r.path)
      if (!r || text === undefined || !core.owned.has(pageId)) continue
      await this.snapshotQuietly(pageId, text, r.path)
      core.lastSnapshot.set(pageId, core.now().getTime())
    }
  }

  /** Newest first; the newest is always what is on disk now, even if another app wrote it. */
  async list(id: string): Promise<HistoryVersion[]> {
    const r = this.core.record(id)
    const text = await this.core.readCurrent(r)
    await this.store.save(id, text, this.snapshotMeta(r.path, text))
    return this.store.list(id)
  }

  async read(id: string, version: string): Promise<PageDoc> {
    const r = this.core.record(id)
    const doc = this.snapshotDoc(r, await this.store.read(id, version))
    return { ...doc, revision: this.core.revision(id) }
  }

  private snapshotDoc(r: PageRecord, snap: Snapshot): PageDoc {
    const doc = this.core.toDoc(snap.meta.path || r.path, snap.text, snap.meta.links)
    return { ...doc, id: r.id, title: r.title, path: r.path }
  }

  /** Replaces content, icon and cover with a snapshot's; title and location stay. */
  async restore(id: string, version: string): Promise<void> {
    const core = this.core
    const r = core.record(id)
    const doc = this.snapshotDoc(r, await this.store.read(id, version))
    const disk = await core.readCurrent(r)
    const { meta: current } = parsePage(disk)
    await this.snapshot(id, disk, r.path)
    core.owned.add(id)
    const meta: PageMeta = {
      ...doc.meta,
      id,
      title: current.title,
      icon: doc.meta.icon ? core.metaHrefToFile(r.path, doc.meta.icon) : undefined,
      cover: doc.meta.cover ? core.toFileHref(r.path, doc.meta.cover) : undefined
    }
    const fileBlocks = core.toFileBlocks(r.path, doc.blocks)
    await core.writeText(r.path, serializePage(meta, fileBlocks))
    r.icon = doc.meta.icon
    const revision = core.revision(id) + 1
    core.revisions.set(id, revision)
    core.index.set(id, r.title, blocksText(doc.blocks))
    core.emit({ type: 'page', id, revision })
  }
}
