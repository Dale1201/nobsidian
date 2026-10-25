import { mkdir, readFile, rename } from 'node:fs/promises'
import { metaFromData, splitFrontmatter } from '../../shared/core/page'
import { childDirOf, dirOf, joinPath } from '../../shared/core/paths'
import type { PageDoc, TrashItem } from '../../shared/types'
import { iconToInternal, type WorkspaceCore } from './core'
import type { ExternalChanges } from './external'
import { exists, removeDirIfEmpty } from './fs-utils'
import type { LinkRewriter } from './links'
import type { PageHistory } from './page-history'
import { Trash } from './trash'

/** Moves pages in and out of the Trash, keeping their place, favorites and links. */
export class PageTrash {
  readonly store: Trash

  constructor(
    private readonly core: WorkspaceCore,
    private readonly external: ExternalChanges,
    private readonly links: LinkRewriter,
    private readonly history: PageHistory
  ) {
    this.store = new Trash(core.root, core.now)
  }

  async trash(id: string): Promise<void> {
    const core = this.core
    const r = core.record(id)
    const removed = [r, ...core.descendantsOf(id)]
    const byPath = core.pathIndex()
    const links: Record<string, string> = {}
    for (const d of removed) {
      const text = core.texts.get(d.path) ?? ''
      Object.assign(links, core.linkIds(d.path, text, byPath))
    }
    await this.store.add({
      id,
      title: r.title,
      originalPath: r.path,
      parentId: r.parentId,
      index: core.childrenOf(r.parentId).indexOf(r),
      favorites: core.state.favorites.filter((f) => removed.some((d) => d.id === f)),
      links
    })
    for (const d of removed) {
      core.stubs.delete(d.path)
      core.pages.delete(d.id)
      core.texts.delete(d.path)
      core.stats.delete(d.path)
      core.index.remove(d.id)
      core.owned.delete(d.id)
    }
    core.removeOrder(r.parentId, id)
    core.state.favorites = core.state.favorites.filter((f) => core.pages.has(f))
    await removeDirIfEmpty(core.abs(dirOf(r.path)))
    await core.persist()
  }

  async list(): Promise<TrashItem[]> {
    const items: TrashItem[] = []
    for (const e of await this.store.list()) {
      const text = await readFile(e.file, 'utf8').catch(() => '')
      const { data } = splitFrontmatter(text)
      const parent = e.meta.parentId ? this.core.pages.get(e.meta.parentId) : undefined
      items.push({
        entry: e.entry,
        pageId: e.meta.id,
        title: e.meta.title,
        icon: iconToInternal(e.meta.originalPath, data ? metaFromData(data).icon : undefined),
        parentTitle: parent ? parent.title || 'Untitled' : null,
        deletedAt: e.meta.deletedAt,
        pageCount: await this.store.countPages(e),
        pageIds: await this.store.pageIds(e)
      })
    }
    return items
  }

  async read(entry: string): Promise<PageDoc> {
    const e = await this.store.get(entry)
    // An entry whose page file was lost still holds its sub-pages.
    const text = await readFile(e.file, 'utf8').catch(() => '')
    const doc = this.core.toDoc(e.meta.originalPath, text)
    return { ...doc, id: e.meta.id, title: e.meta.title }
  }

  /** Puts a page back where it was, or at the top level if its parent is gone. */
  async restore(entry: string): Promise<string> {
    const core = this.core
    const e = await this.store.get(entry)
    const parent = e.meta.parentId ? (core.pages.get(e.meta.parentId) ?? null) : null
    const dir = parent ? childDirOf(parent.path) : ''
    await mkdir(core.abs(dir), { recursive: true })
    const stem = await core.pageStem(dir, e.meta.title)
    const path = joinPath(dir, `${stem}.md`)
    if (await exists(e.file)) await rename(e.file, core.abs(path))
    if (await exists(e.folder)) await rename(e.folder, core.abs(childDirOf(path)))
    await this.store.remove(e)
    await this.external.rescanChanges()
    // Found by path: if a live page holds the same id, the scan gave this one a new id.
    const r = core.record(core.pathIndex().get(path)!)
    const restored = [r, ...core.descendantsOf(r.id)]
    const moved = new Map<string, string>()
    if (path !== e.meta.originalPath) {
      moved.set(e.meta.originalPath, path)
      const oldChildDir = childDirOf(e.meta.originalPath)
      for (const d of restored.slice(1)) {
        moved.set(oldChildDir + d.path.slice(childDirOf(path).length), d.path)
      }
    }
    await this.links.relinkRestored(restored, moved, e.meta.links ?? {})
    r.title = e.meta.title
    core.index.setTitle(r.id, r.title)
    await this.links.syncTitleField(r)
    const sameParent = (parent?.id ?? null) === e.meta.parentId
    core.insertOrder(parent?.id ?? null, r.id, sameParent ? e.meta.index : undefined)
    for (const d of restored) {
      const was = d === r ? e.meta.id : d.id
      const favorite = e.meta.favorites?.includes(was) && !core.state.favorites.includes(d.id)
      if (favorite) core.state.favorites.push(d.id)
    }
    await core.persist()
    return r.id
  }

  async delete(entry: string): Promise<void> {
    const e = await this.store.get(entry)
    // A live page can share an id with a trashed one (a sync tool recreated it); its history stays.
    const ids = (await this.store.pageIds(e)).filter((id) => !this.core.pages.has(id))
    await this.history.store.remove(ids)
    await this.store.remove(e)
  }
}
