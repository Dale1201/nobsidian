import { mkdir, readFile, readdir, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { HistoryVersion } from '../../shared/types'
import { PAGE_ID } from '../../shared/core/page'
import { APP_DIR } from '../workspace/state'
import { writeFileAtomic } from '../workspace/fs-utils'

/** What a snapshot needs besides its text to be restored after renames and moves. */
export interface SnapshotMeta {
  /** The page's workspace path when the snapshot was taken. */
  path: string
  /** Workspace path of each linked page at that time -> its page id. */
  links: Record<string, string>
}

export interface Snapshot {
  text: string
  meta: SnapshotMeta
}

const DAY_MS = 24 * 60 * 60 * 1000
export const FULL_RETENTION_DAYS = 30

export class HistoryStore {
  /** Newest snapshot text per page, so unchanged content is never stored twice. */
  private latest = new Map<string, string | null>()

  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private dir(pageId: string): string {
    if (!PAGE_ID.test(pageId)) throw new Error(`Unknown page ${pageId}`)
    return join(this.root, APP_DIR, 'history', pageId)
  }

  /** Stores a snapshot unless it matches the newest one; returns the new version or null. */
  async save(pageId: string, text: string, meta: SnapshotMeta): Promise<HistoryVersion | null> {
    if ((await this.latestText(pageId)) === text) return null
    const dir = this.dir(pageId)
    await mkdir(dir, { recursive: true })
    const existing = new Set(await this.versionIds(pageId))
    let at = this.now().getTime()
    while (existing.has(versionId(new Date(at)))) at++
    const id = versionId(new Date(at))
    await writeFileAtomic(join(dir, `${id}.json`), JSON.stringify(meta, null, 2) + '\n')
    await writeFileAtomic(join(dir, `${id}.md`), text)
    this.latest.set(pageId, text)
    return { id, at: new Date(at).toISOString() }
  }

  /** Newest first. */
  async list(pageId: string): Promise<HistoryVersion[]> {
    return (await this.versionIds(pageId))
      .reverse()
      .map((id) => ({ id, at: timeOf(id).toISOString() }))
  }

  async read(pageId: string, id: string): Promise<Snapshot> {
    if (!/^[\dTZ-]+$/.test(id)) throw new Error(`Unknown version ${id}`)
    const dir = this.dir(pageId)
    const text = await readFile(join(dir, `${id}.md`), 'utf8')
    let meta: SnapshotMeta = { path: '', links: {} }
    try {
      meta = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8')) as SnapshotMeta
    } catch {
      // A snapshot without its sidecar still restores; only renamed links may break.
    }
    return { text, meta }
  }

  async remove(pageIds: string[]): Promise<void> {
    for (const id of pageIds) {
      await rm(this.dir(id), { recursive: true, force: true })
      this.latest.delete(id)
    }
  }

  /** Keeps everything newer than 30 days, and the newest snapshot of each older day. */
  async prune(): Promise<void> {
    const base = join(this.root, APP_DIR, 'history')
    const pages = await readdir(base).catch(() => [] as string[])
    const cutoff = this.now().getTime() - FULL_RETENTION_DAYS * DAY_MS
    for (const pageId of pages) {
      const keepPerDay = new Map<string, string>()
      const old: string[] = []
      for (const id of await this.versionIds(pageId)) {
        const at = timeOf(id)
        if (at.getTime() >= cutoff) continue
        old.push(id)
        // Ids sort chronologically, so the last one seen for a day is its newest.
        keepPerDay.set(localDay(at), id)
      }
      const keep = new Set(keepPerDay.values())
      for (const id of old) {
        if (keep.has(id)) continue
        await unlink(join(this.dir(pageId), `${id}.md`)).catch(() => {})
        await unlink(join(this.dir(pageId), `${id}.json`)).catch(() => {})
      }
    }
  }

  private async latestText(pageId: string): Promise<string | null> {
    if (!this.latest.has(pageId)) {
      const ids = await this.versionIds(pageId)
      const last = ids[ids.length - 1]
      this.latest.set(
        pageId,
        last ? await readFile(join(this.dir(pageId), `${last}.md`), 'utf8').catch(() => null) : null
      )
    }
    return this.latest.get(pageId) ?? null
  }

  /** Oldest first. */
  private async versionIds(pageId: string): Promise<string[]> {
    const names = await readdir(this.dir(pageId)).catch(() => [] as string[])
    return names
      .filter((n) => n.endsWith('.md'))
      .map((n) => n.slice(0, -3))
      .sort()
  }
}

/** A filename-safe UTC timestamp that sorts chronologically, e.g. 2026-10-21T14-03-22-123Z. */
function versionId(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

function timeOf(id: string): Date {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(id)
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : new Date(0)
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}
