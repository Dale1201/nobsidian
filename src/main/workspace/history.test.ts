import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Block } from '../../shared/core/blocks'
import { pageLinkHref } from '../../shared/core/links'
import { parsePage } from '../../shared/core/page'
import { blocksText } from '../../shared/core/text'
import { Workspace, type WorkspaceEvent } from './workspace'

let root: string
let clock: Date

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nobsidian-history-ws-'))
  clock = new Date('2026-10-21T10:00:00.000Z')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const open = (): Promise<Workspace> => Workspace.open(root, { now: () => clock, settleMs: 0 })
const read = (rel: string): Promise<string> => readFile(join(root, rel), 'utf8')
const later = (minutes: number): void => {
  clock = new Date(clock.getTime() + minutes * 60_000)
}
const text = (t: string): Block => ({
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text: t, styles: {} }],
  children: []
})
const link = (id: string): Block => ({
  type: 'pageLink',
  props: { href: pageLinkHref(id) },
  children: []
})

/** Snapshot files of a page, newest first, as stored. */
async function snapshots(id: string): Promise<string[]> {
  const dir = join(root, '.nobsidian', 'history', id)
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.md'))
  return Promise.all(
    names
      .sort()
      .reverse()
      .map((n) => readFile(join(dir, n), 'utf8'))
  )
}
const bodies = async (id: string): Promise<string[]> =>
  (await snapshots(id)).map((s) => blocksText(parsePage(s).blocks))

describe('Page history', () => {
  it('keeps the text a file had before the app first changes it', async () => {
    await writeFile(join(root, 'Notes.md'), 'Written  elsewhere *loosely*\n')
    const ws = await open()
    const id = ws.tree()[0].id
    await ws.writePage(id, [text('Mine')])
    expect(await snapshots(id)).toEqual([`---\nid: ${id}\n---\n\nWritten  elsewhere *loosely*\n`])
  })

  it('snapshots at most every 10 minutes while editing, and when leaving the page', async () => {
    const ws = await open()
    const { id } = await ws.createPage(null)
    await ws.writePage(id, [text('one')])
    later(5)
    await ws.writePage(id, [text('two')])
    later(6)
    await ws.writePage(id, [text('three')])
    later(1)
    await ws.writePage(id, [text('four')])
    expect(await bodies(id)).toEqual(['three'])
    await ws.checkpoint(id)
    await ws.checkpoint(id)
    expect(await bodies(id)).toEqual(['four', 'three'])
  })

  it('lists what is on disk now as the newest version, even when another app wrote it', async () => {
    const ws = await open()
    const { id, path } = await ws.createPage(null)
    await ws.writePage(id, [text('mine')])
    await ws.checkpoint(id)
    later(1)
    const head = /^---\n[\s\S]*?\n---\n/.exec(await read(path))![0]
    await writeFile(join(root, path), `${head}\ntheirs\n`)
    const [newest, older] = await ws.listHistory(id)
    expect(blocksText((await ws.readHistory(id, newest.id)).blocks)).toBe('theirs')
    expect(blocksText((await ws.readHistory(id, older.id)).blocks)).toBe('mine')
  })

  it('keeps a draft the editor could not save in history, with the page’s icon', async () => {
    const ws = await open()
    const { id } = await ws.createPage(null)
    await ws.updateMeta(id, { icon: '📌' })
    await ws.keepDraft(id, [text('unsaved words')])
    const [draft] = await snapshots(id)
    expect(parsePage(draft).meta).toMatchObject({ id, icon: '📌' })
    expect(blocksText(parsePage(draft).blocks)).toBe('unsaved words')
  })

  it('restores a version with links that survived renames, keeping title and location', async () => {
    const ws = await open()
    const target = await ws.createPage(null)
    await ws.renamePage(target.id, 'Target')
    const p = await ws.createPage(null)
    await ws.renamePage(p.id, 'Page')
    await ws.updateMeta(p.id, { icon: '📌' })
    await ws.writePage(p.id, [text('old'), link(target.id)])
    const [old] = await ws.listHistory(p.id)
    later(1)
    await ws.writePage(p.id, [text('new')])
    await ws.updateMeta(p.id, { icon: '🔥' })
    await ws.renamePage(target.id, 'Renamed target')
    await ws.renamePage(p.id, 'Renamed page')
    const events: WorkspaceEvent[] = []
    ws.onEvent((e) => events.push(e))
    const preview = await ws.readHistory(p.id, old.id)
    expect(preview.blocks).toEqual([text('old'), link(target.id)])
    await ws.restoreHistory(p.id, old.id)
    expect(await read('Renamed page.md')).toBe(
      `---\nid: ${p.id}\nicon: 📌\n---\n\nold\n\n[Renamed target](Renamed%20target.md "page")\n`
    )
    expect(ws.tree().find((n) => n.id === p.id)).toMatchObject({
      title: 'Renamed page',
      icon: '📌'
    })
    expect(events).toEqual([{ type: 'page', id: p.id, revision: 1 }])
    expect((await ws.readPage(p.id)).revision).toBe(1)
    expect((await bodies(p.id))[0]).toBe('new')
    expect((await ws.search('old')).map((h) => h.id)).toEqual([p.id])
  })

  it('keeps unsaved edits to a page deleted outside the app in its history', async () => {
    const ws = await open()
    const { id, path } = await ws.createPage(null)
    await unlink(join(root, path))
    expect(await ws.writePage(id, [text('last words')], { revision: 0 })).toEqual({
      ok: false,
      reason: 'gone'
    })
    expect(await snapshots(id)).toEqual([`---\nid: ${id}\ntitle: ""\n---\n\nlast words\n`])
  })
})
