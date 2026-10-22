import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapBlockLinks, pageLinkHref } from '../../shared/core/links'
import { blocksToMarkdown } from '../../shared/core/serialize'
import { sanitizeTitle } from '../../shared/core/paths'
import { runImport } from './pipeline'
import { FIXTURE_ZIP, notionPage, subPageLink, writeZip } from './test-zips'
import { ImportError, type ImportManifest } from './types'

const EXPECTED = join(__dirname, '../../../tests/fixtures/notion-export.expected')
const id = (n: number): string => n.toString(16).padStart(32, '0')

async function staging(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nb-stage-'))
}

/** Answers every download with a tiny PNG, recording the addresses asked for. */
function fakeFetch(asked: string[] = [], ok = true): typeof fetch {
  return (async (url: string) => {
    asked.push(url)
    return ok
      ? new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'content-type': 'image/png' }
        })
      : new Response('gone', { status: 404 })
  }) as unknown as typeof fetch
}

function byTitle(manifest: ImportManifest, title: string): ImportManifest['pages'][number] {
  return manifest.pages.find((p) => p.title === title)!
}

describe('runImport on the fixture export', () => {
  it('converts every page as reviewed', async () => {
    const asked: string[] = []
    const manifest = await runImport({
      zips: [FIXTURE_ZIP],
      staging: await staging(),
      fetch: fakeFetch(asked)
    })
    expect(manifest.pages.map((p) => p.title)).toEqual([
      'Nobsidian import fixture',
      'Child page',
      'Grandchild page',
      'Q&A: plans / ideas?',
      'Same name',
      'Same name',
      'Reading list',
      'The Left Hand of Darkness',
      'Untitled draft',
      'A Brief History of Time'
    ])
    // Page ids are random; the Notion ids they replace are not.
    const stable = new Map(
      manifest.pages.map((p) => [pageLinkHref(p.id), `notion://${p.notionId}`])
    )
    for (const [i, page] of manifest.pages.entries()) {
      const name = `${String(i + 1).padStart(2, '0')} ${sanitizeTitle(page.title)}.md`
      const blocks = mapBlockLinks(page.blocks, (href) => stable.get(href) ?? href)
      await expect(blocksToMarkdown(blocks)).toMatchFileSnapshot(join(EXPECTED, name))
    }
    expect(asked).toEqual([
      'https://www.notion.so/images/page-cover/gradients_8.png',
      'https://www.notion.so/images/page-cover/gradients_2.png'
    ])
  })

  it('rebuilds the page tree and keeps icons, covers and Notion ids', async () => {
    const manifest = await runImport({
      zips: [FIXTURE_ZIP],
      staging: await staging(),
      fetch: fakeFetch()
    })
    const root = byTitle(manifest, 'Nobsidian import fixture')
    const child = byTitle(manifest, 'Child page')
    expect(root.parentId).toBeNull()
    expect(root.notionId).toBe('4007c9e82e0e81549d17cfdfeaddaf81')
    expect(root.icon).toBe('🧪')
    expect(root.cover).toMatch(/^nobsidian-import:file\/\d+$/)
    expect(child.parentId).toBe(root.id)
    expect(child.icon).toBe('🌱')
    expect(byTitle(manifest, 'Grandchild page').parentId).toBe(child.id)
    expect(byTitle(manifest, 'Untitled draft').parentId).toBe(byTitle(manifest, 'Reading list').id)
  })

  it('stages each referenced file once', async () => {
    const manifest = await runImport({
      zips: [FIXTURE_ZIP],
      staging: await staging(),
      fetch: fakeFetch()
    })
    expect(manifest.files.map((f) => f.name).sort()).toEqual([
      'fixture-image.png',
      'fixture-report.pdf',
      'gradients_2.png',
      'gradients_8.png'
    ])
    const image = manifest.files.find((f) => f.name === 'fixture-image.png')!
    expect((await readFile(image.path!)).length).toBe(32088)
  })

  it('keeps a link and reports an image it could not download', async () => {
    const manifest = await runImport({
      zips: [FIXTURE_ZIP],
      staging: await staging(),
      fetch: fakeFetch([], false)
    })
    const cover = manifest.files.find((f) => f.name === 'gradients_8.png')!
    expect(cover.path).toBeUndefined()
    expect(cover.url).toBe('https://www.notion.so/images/page-cover/gradients_8.png')
    expect(manifest.issues.filter((i) => i.kind === 'download')).toHaveLength(2)
  })
})

describe('runImport', () => {
  it('makes a page for each top-level folder when an export has several', async () => {
    const dir = await staging()
    const zip = await writeZip(join(dir, 'e.zip'), {
      [`Private & Shared/A ${id(1)}.html`]: notionPage('A'),
      [`Team/B ${id(2)}.html`]: notionPage('B')
    })
    const manifest = await runImport({ zips: [zip], staging: dir })
    const titles = manifest.pages.map((p) => [p.title, p.parentId === null])
    expect(titles).toEqual([
      ['Private & Shared', true],
      ['Team', true],
      ['A', false],
      ['B', false]
    ])
  })

  it('reports links to pages outside the export and files missing from it', async () => {
    const dir = await staging()
    const zip = await writeZip(join(dir, 'e.zip'), {
      [`S/A ${id(1)}.html`]: notionPage(
        'A',
        '<p><a href="https://www.notion.so/Other-' +
          id(9) +
          '">Other</a></p><figure class="image"><img src="A/gone.png"></figure>' +
          subPageLink(`https://app.notion.com/p/Left-out-${id(8)}`, id(8), 'Left out') +
          subPageLink(`A/B ${id(2)}.html`, id(2), 'B')
      ),
      [`S/A/B ${id(2)}.html`]: notionPage('B', '<p>Inside</p>')
    })
    const manifest = await runImport({ zips: [zip], staging: dir })
    expect(manifest.issues.map((i) => [i.kind, i.detail])).toEqual([
      ['outsideLink', `https://www.notion.so/Other-${id(9)}`],
      ['missingFile', 'S/A/gone.png'],
      ['outsideLink', `https://app.notion.com/p/Left-out-${id(8)}`]
    ])
    expect(manifest.pages[1].parentId).toBe(manifest.pages[0].id)
    expect(
      manifest.pages[0].blocks.find(
        (b) => b.type === 'paragraph' && JSON.stringify(b).includes('Left out')
      )
    ).toBeDefined()
  })

  it('refuses a Markdown export and a zip that is not from Notion', async () => {
    const dir = await staging()
    const markdown = await writeZip(join(dir, 'm.zip'), { [`S/A ${id(1)}.md`]: '# A' })
    const other = await writeZip(join(dir, 'o.zip'), { 'photo.jpg': 'jpg' })
    await expect(runImport({ zips: [markdown], staging: dir })).rejects.toThrow(
      new ImportError('This is a Markdown export. Export again as HTML.')
    )
    await expect(runImport({ zips: [other], staging: dir })).rejects.toThrow(
      new ImportError("This zip isn't a Notion HTML export.")
    )
  })

  it('reports progress through each phase', async () => {
    const phases: string[] = []
    await runImport({
      zips: [FIXTURE_ZIP],
      staging: await staging(),
      fetch: fakeFetch(),
      onProgress: (p) => {
        if (phases[phases.length - 1] !== p.phase) phases.push(p.phase)
      }
    })
    expect(phases).toEqual(['reading', 'converting', 'copying'])
  })
})
