import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from './workspace'
import { pageLinkHref } from '../../shared/core/links'
import type { Block } from '../../shared/core/blocks'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nobsidian-ws-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const read = (rel: string): Promise<string> => readFile(join(root, rel), 'utf8')
const text = (t: string): Block => ({
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text: t, styles: {} }],
  children: []
})

describe('Workspace scanning', () => {
  it('builds a nested tree and assigns ids to files without one', async () => {
    await writeFile(join(root, 'Projects.md'), '# Projects\n')
    await mkdir(join(root, 'Projects'))
    await writeFile(join(root, 'Projects', 'Website.md'), 'Hello\n')
    await mkdir(join(root, 'Orphan Folder'))
    await writeFile(join(root, 'Orphan Folder', 'Child.md'), '')
    const ws = await Workspace.open(root)
    const tree = ws.tree()
    expect(tree.map((n) => n.title)).toEqual(['Orphan Folder', 'Projects'])
    expect(tree[1].children.map((n) => n.path)).toEqual(['Projects/Website.md'])
    expect(await read('Projects/Website.md')).toMatch(/^---\nid: [0-9a-f-]{36}\n---\n\nHello\n$/)
    expect(await read('Orphan Folder.md')).toMatch(/^---\nid: /)
  })

  it('refuses to open a folder that does not exist', async () => {
    await expect(Workspace.open(join(root, 'missing'))).rejects.toThrow('Folder not found')
    await expect(readdir(join(root, 'missing'))).rejects.toThrow()
  })

  it('ignores attachments and the app folder', async () => {
    await mkdir(join(root, 'attachments'))
    await writeFile(join(root, 'attachments', 'note.md'), 'not a page')
    await mkdir(join(root, '.nobsidian'))
    const ws = await Workspace.open(root)
    expect(ws.tree()).toEqual([])
  })

  it('gives duplicated ids a fresh one', async () => {
    const same = '---\nid: 11111111-1111-1111-1111-111111111111\n---\n'
    await writeFile(join(root, 'A.md'), same)
    await writeFile(join(root, 'B.md'), same)
    const ws = await Workspace.open(root)
    const ids = ws.tree().map((n) => n.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('Workspace page operations', () => {
  it('creates, writes and reads pages', async () => {
    const ws = await Workspace.open(root)
    const a = await ws.createPage(null)
    const b = await ws.createPage(null)
    expect([a.path, b.path]).toEqual(['Untitled.md', 'Untitled (2).md'])
    expect(await read('Untitled (2).md')).toContain('title: ""')
    await ws.writePage(a.id, [text('Body')])
    const doc = await ws.readPage(a.id)
    expect(doc.blocks).toEqual([text('Body')])
    expect(await read('Untitled.md')).toBe(`---\nid: ${a.id}\ntitle: ""\n---\n\nBody\n`)
  })

  it('renames a page with its children and rewrites links', async () => {
    const ws = await Workspace.open(root)
    const parent = await ws.createPage(null)
    const child = await ws.createPage(parent.id)
    const other = await ws.createPage(null)
    await ws.writePage(other.id, [
      { type: 'pageLink', props: { href: pageLinkHref(child.id) }, children: [] }
    ])
    expect(await read(other.path)).toContain('[Untitled](Untitled/Untitled.md "page")')
    await ws.renamePage(parent.id, 'Projects / 2026')
    expect(ws.tree()[0].path).toBe('Projects - 2026.md')
    expect(await read('Projects - 2026.md')).toContain('title: Projects / 2026')
    expect(await readdir(join(root, 'Projects - 2026'))).toEqual(['Untitled.md'])
    expect(await read(other.path)).toContain('(Projects%20-%202026/Untitled.md "page")')
    const doc = await ws.readPage(other.id)
    expect(doc.blocks[0]).toMatchObject({
      type: 'pageLink',
      props: { href: pageLinkHref(child.id) }
    })
  })

  it('moves a page and keeps its relative links working', async () => {
    const ws = await Workspace.open(root)
    const target = await ws.createPage(null)
    await ws.renamePage(target.id, 'Target')
    const mover = await ws.createPage(null)
    await ws.renamePage(mover.id, 'Mover')
    const asset = await ws.saveAttachment('cat photo.png', new Uint8Array([1, 2, 3]))
    expect(asset).toBe('/attachments/cat%20photo.png')
    await ws.writePage(mover.id, [
      { type: 'image', props: { url: asset, caption: '' }, children: [] },
      text('x')
    ])
    expect(await read('Mover.md')).toContain('![](attachments/cat%20photo.png)')
    await ws.movePage(mover.id, target.id, 0)
    expect(await read('Target/Mover.md')).toContain('![](../attachments/cat%20photo.png)')
    expect(ws.tree()[0].children.map((c) => c.title)).toEqual(['Mover'])
    await expect(readdir(join(root, 'Mover'))).rejects.toThrow()
  })

  it('never names a root page like the attachments folder', async () => {
    const ws = await Workspace.open(root)
    const p = await ws.createPage(null)
    await ws.renamePage(p.id, 'Attachments')
    expect(ws.tree()[0]).toMatchObject({ title: 'Attachments', path: 'Attachments (2).md' })
  })

  it('refuses to move a page into its own descendant', async () => {
    const ws = await Workspace.open(root)
    const a = await ws.createPage(null)
    const b = await ws.createPage(a.id)
    await expect(ws.movePage(a.id, b.id, 0)).rejects.toThrow('inside itself')
  })

  it('reorders siblings and persists the order', async () => {
    const ws = await Workspace.open(root)
    const a = await ws.createPage(null)
    const b = await ws.createPage(null)
    await ws.movePage(b.id, null, 0)
    expect(ws.tree().map((n) => n.id)).toEqual([b.id, a.id])
    const reopened = await Workspace.open(root)
    expect(reopened.tree().map((n) => n.id)).toEqual([b.id, a.id])
  })

  it('trashes a page with its children and keeps links serializable', async () => {
    const ws = await Workspace.open(root)
    const a = await ws.createPage(null)
    await ws.createPage(a.id)
    const keep = await ws.createPage(null)
    await ws.writePage(keep.id, [
      { type: 'pageLink', props: { href: pageLinkHref(a.id) }, children: [] }
    ])
    await ws.setFavorite(a.id, true)
    await ws.trashPage(a.id)
    expect(ws.tree().map((n) => n.id)).toEqual([keep.id])
    expect(ws.favorites()).toEqual([])
    const trash = await readdir(join(root, '.nobsidian', 'trash'))
    expect(trash).toHaveLength(1)
    expect((await readdir(join(root, '.nobsidian', 'trash', trash[0]))).sort()).toEqual([
      'Untitled',
      'Untitled.md',
      'meta.json'
    ])
    await ws.writePage(keep.id, (await ws.readPage(keep.id)).blocks)
    expect(await read(keep.path)).toContain('(Untitled.md "page")')
  })

  it('updates icon, cover and full width in frontmatter', async () => {
    const ws = await Workspace.open(root)
    const p = await ws.createPage(null)
    const cover = await ws.saveAttachment('cover.jpg', new Uint8Array([9]))
    await ws.updateMeta(p.id, { icon: '🚀', cover, coverPosition: 30, fullWidth: true })
    expect(await read(p.path)).toBe(
      `---\nid: ${p.id}\ntitle: ""\nicon: 🚀\ncover: attachments/cover.jpg\ncoverPosition: 30\nfullWidth: true\n---\n`
    )
    const doc = await ws.readPage(p.id)
    expect(doc.meta).toMatchObject({ icon: '🚀', cover: '/attachments/cover.jpg', fullWidth: true })
    expect(ws.tree()[0].icon).toBe('🚀')
  })

  it('serializes concurrent writes', async () => {
    const ws = await Workspace.open(root)
    const p = await ws.createPage(null)
    await Promise.all([
      ws.writePage(p.id, [text('one')]),
      ws.renamePage(p.id, 'Renamed'),
      ws.writePage(p.id, [text('two')])
    ])
    expect(await read('Renamed.md')).toBe(`---\nid: ${p.id}\n---\n\ntwo\n`)
  })

  it('refuses asset paths outside the workspace', async () => {
    const ws = await Workspace.open(root)
    expect(ws.resolveAsset('/../../etc/passwd')).toBe(join(root, 'etc', 'passwd'))
    expect(ws.resolveAsset('/.nobsidian/workspace.json')).toBeNull()
  })
})
