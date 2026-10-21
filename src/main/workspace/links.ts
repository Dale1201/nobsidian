import { rename } from 'node:fs/promises'
import { mapBlockLinks } from '../../shared/core/links'
import { parsePage, serializePage } from '../../shared/core/page'
import {
  childDirOf,
  decodeHref,
  isExternalHref,
  joinPath,
  relativeHref,
  resolveHref,
  stemOf
} from '../../shared/core/paths'
import type { PageRecord, WorkspaceCore } from './core'
import { exists } from './fs-utils'
import type { PageHistory } from './page-history'

/** Moves page files and keeps every link to them pointing at the right place. */
export class LinkRewriter {
  constructor(
    private readonly core: WorkspaceCore,
    private readonly history: PageHistory
  ) {}

  /** Stores the exact title in frontmatter only when the filename cannot carry it. */
  async syncTitleField(r: PageRecord): Promise<void> {
    const disk = await this.core.readCurrent(r)
    const { meta, blocks } = parsePage(disk)
    const title = stemOf(r.path) === r.title ? undefined : r.title
    if (meta.title === title) return
    await this.history.rewrite(r, disk, serializePage({ ...meta, id: r.id, title }, blocks))
  }

  /** Moves a page file (and its child folder) to `dir/stem.md`, then fixes links everywhere. */
  async relocate(r: PageRecord, dir: string, stem: string): Promise<void> {
    const core = this.core
    const oldPath = r.path
    const newPath = joinPath(dir, `${stem}.md`)
    if (oldPath === newPath) return
    const moved = new Map<string, string>()
    const oldChildDir = childDirOf(oldPath)
    const newChildDir = childDirOf(newPath)
    moved.set(oldPath, newPath)
    for (const d of core.descendantsOf(r.id)) {
      moved.set(d.path, newChildDir + d.path.slice(oldChildDir.length))
    }
    await rename(core.abs(oldPath), core.abs(newPath))
    if (await exists(core.abs(oldChildDir)))
      await rename(core.abs(oldChildDir), core.abs(newChildDir))
    for (const rec of [r, ...core.descendantsOf(r.id)]) {
      const next = moved.get(rec.path) ?? rec.path
      const text = core.texts.get(rec.path)
      core.texts.delete(rec.path)
      core.stats.delete(rec.path)
      core.stubs.delete(rec.path)
      if (text !== undefined) core.remember(next, text)
      rec.path = next
      core.knownPaths.set(rec.id, rec.path)
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
    for (const rec of this.core.pages.values()) {
      if (skip.has(rec.id)) continue
      const cached = this.core.texts.get(rec.path)
      const candidate =
        newToOld.has(rec.path) || cached === undefined || needles.some((n) => cached.includes(n))
      if (!candidate) continue
      await this.relink(rec, newToOld.get(rec.path) ?? rec.path, (t) => moved.get(t) ?? t)
    }
  }

  /** After a restore: the restored pages' own links, then links elsewhere to their old paths. */
  async relinkRestored(
    restored: PageRecord[],
    moved: Map<string, string>,
    linkIds: Record<string, string>
  ): Promise<void> {
    const newToOld = new Map([...moved].map(([o, n]) => [n, o]))
    for (const rec of restored) {
      // Through ids, so targets renamed while this page was in Trash are still found.
      await this.relink(rec, newToOld.get(rec.path) ?? rec.path, (target) => {
        const id = linkIds[target]
        return moved.get(target) ?? (id ? this.core.pages.get(id)?.path : undefined) ?? target
      })
    }
    // A page created at an old path since the delete keeps the links that now point to it.
    const byPath = this.core.pathIndex()
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
    const disk = await this.core.readCurrent(rec)
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
    if (changed) await this.history.rewrite(rec, disk, serializePage(nextMeta, nextBlocks))
  }
}
