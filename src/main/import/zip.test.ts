import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ImportError } from './types'
import { openExport, peekExport } from './zip'
import { writeZip } from './test-zips'

const PAGE = 'Notes 0123456789abcdef0123456789abcdef'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nb-zip-'))
  dirs.push(dir)
  return dir
}

describe('openExport', () => {
  it('reads zips inside zips and several zips as one export', async () => {
    const dir = await tempDir()
    const part1 = await writeZip(join(dir, 'p1.zip'), { [`Space/${PAGE}.html`]: '<p>1</p>' })
    const part2 = await writeZip(join(dir, 'p2.zip'), { 'Space/Notes/image.png': 'png' })
    const outer = await writeZip(join(dir, 'Export-abc.zip'), {
      'Export-abc-Part-1.zip': await readFile(part1),
      'Export-abc-Part-2.zip': await readFile(part2),
      '__MACOSX/._x': 'junk'
    })
    const extra = await writeZip(join(dir, 'extra.zip'), { 'Other/Page.html': '<p>2</p>' })
    const archive = await openExport([outer, extra], dir)
    try {
      expect([...archive.entries.keys()].sort()).toEqual([
        'Other/Page.html',
        `Space/${PAGE}.html`,
        'Space/Notes/image.png'
      ])
      expect((await archive.entries.get(`Space/${PAGE}.html`)!.read()).toString()).toBe('<p>1</p>')
      await archive.entries.get('Space/Notes/image.png')!.copyTo(join(dir, 'copy.png'))
      expect(await readFile(join(dir, 'copy.png'), 'utf8')).toBe('png')
    } finally {
      archive.close()
    }
  })

  it('refuses a file that is not a zip', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'fake.zip'), 'not a zip')
    await expect(openExport([join(dir, 'fake.zip')], dir)).rejects.toThrow(ImportError)
  })

  it('keeps a zip attached to a page as a file instead of opening it', async () => {
    const dir = await tempDir()
    const outer = await writeZip(join(dir, 'Export.zip'), {
      [`Space/${PAGE}.html`]: '<p>1</p>',
      'Space/Notes/backup.zip': 'not a zip'
    })
    const archive = await openExport([outer], dir)
    try {
      expect(archive.entries.get('Space/Notes/backup.zip')!.path).toBe('Space/Notes/backup.zip')
      expect((await archive.entries.get('Space/Notes/backup.zip')!.read()).toString()).toBe(
        'not a zip'
      )
    } finally {
      archive.close()
    }
  })
})

describe('peekExport', () => {
  it('tells HTML and Markdown exports, part zips and other zips apart', async () => {
    const dir = await tempDir()
    const html = await writeZip(join(dir, 'a.zip'), { [`S/${PAGE}.html`]: '' })
    const markdown = await writeZip(join(dir, 'b.zip'), { [`S/${PAGE}.md`]: '' })
    const parts = await writeZip(join(dir, 'c.zip'), { 'ExportBlock-1-Part-1.zip': '' })
    const other = await writeZip(join(dir, 'd.zip'), { 'photo.jpg': '' })
    await writeFile(join(dir, 'e.zip'), 'nope')
    expect(await peekExport(html)).toBe('notion-html')
    expect(await peekExport(markdown)).toBe('notion-markdown')
    expect(await peekExport(parts)).toBe('notion-html')
    expect(await peekExport(other)).toBe('other')
    expect(await peekExport(join(dir, 'e.zip'))).toBe('other')
  })
})
