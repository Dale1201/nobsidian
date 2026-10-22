import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { blocksToMarkdown } from '../core/serialize'
import { mapNotionPaste, notionPageIds, readNotionClipboard } from './paste'
import type { MapContext } from './types'

const CLIPBOARD = join(__dirname, '../../../tests/fixtures/notion-clipboard')

function context(pages: Record<string, string> = {}): MapContext & { issues: string[] } {
  const issues: string[] = []
  return {
    issues,
    link: (href, pageId) => {
      const id = pageId?.replace(/-/g, '')
      return id && pages[id] ? `nobsidian://page/${pages[id]}` : href
    },
    file: (src) => src,
    issue: (kind, detail) => issues.push(`${kind}: ${detail}`)
  }
}

/** Records in Notion's clipboard format, one top-level block per entry. */
function records(
  blocks: Record<string, unknown>[],
  children: Record<string, unknown>[] = []
): string {
  const all = [...blocks, ...children]
  return JSON.stringify({
    blocks: blocks.map((b) => ({
      blockId: b.id,
      blockSubtree: {
        __version__: 3,
        block: Object.fromEntries(
          all
            .filter((c) => c === b || (b.content as string[] | undefined)?.includes(c.id as string))
            .map((c) => [c.id, { value: c }])
        )
      }
    }))
  })
}

describe('mapNotionPaste', () => {
  it('maps the fixture page copied from Notion', async () => {
    const html = readFileSync(join(CLIPBOARD, 'page.html'), 'utf8')
    const json = readFileSync(join(CLIPBOARD, 'records.json'), 'utf8')
    const ctx = context()
    const markdown = blocksToMarkdown(mapNotionPaste({ records: json, html }, ctx))
    await expect(markdown).toMatchFileSnapshot(join(CLIPBOARD, 'expected.md'))
    expect(ctx.issues).toEqual([
      'table: Header column (kept as a normal column)',
      'missingFile: fixture-image.png',
      'missingFile: fixture-report.pdf'
    ])
  })

  it('maps rich text marks, colors and mentions', () => {
    const json = records([
      {
        id: 'a',
        type: 'text',
        properties: {
          title: [
            ['bold', [['b']]],
            [' '],
            ['red', [['h', 'red']]],
            [' '],
            ['green', [['h', 'teal_background']]],
            [' '],
            ['‣', [['p', '11111111-2222-3333-4444-555555555555']]],
            [' '],
            ['‣', [['d', { type: 'date', start_date: '2026-03-14' }]]],
            [' '],
            ['⁍', [['e', 'x^2']]]
          ]
        }
      }
    ])
    const html =
      '<p>bold red green <a href="https://www.notion.so/Plans-11111111222233334444555555555555">Plans</a></p>'
    const ctx = context({ '11111111222233334444555555555555': 'page-1' })
    expect(blocksToMarkdown(mapNotionPaste({ records: json, html }, ctx))).toBe(
      '**bold** <span data-color="red">red</span> <span data-bg="green">green</span> ' +
        '[Plans](nobsidian://page/page-1) @March 14, 2026 $x^2$\n'
    )
  })

  it('names a mentioned person from the HTML copy', () => {
    const json = records([
      {
        id: 'a',
        type: 'text',
        properties: { title: [['Ask '], ['‣', [['u', 'user-1']]], [' today.']] }
      }
    ])
    const html = '<p>Ask @Ada Lovelace today.</p>'
    expect(blocksToMarkdown(mapNotionPaste({ records: json, html }, context()))).toBe(
      'Ask @Ada Lovelace today.\n'
    )
  })

  it('takes a synced block’s content from the HTML copy', () => {
    const json = records([
      { id: 'a', type: 'text', properties: { title: [['Before']] } },
      { id: 's', type: 'transclusion_container', content: ['missing'] },
      { id: 'b', type: 'text', properties: { title: [['After']] } }
    ])
    const html = '<p>Before</p><p>Synced one</p><ul><li>Synced two</li></ul><p>After</p>'
    expect(blocksToMarkdown(mapNotionPaste({ records: json, html }, context()))).toBe(
      'Before\n\nSynced one\n\n- Synced two\n\nAfter\n'
    )
  })

  it('maps callouts, columns and to-dos', () => {
    const json = records(
      [
        {
          id: 'c',
          type: 'callout',
          format: { page_icon: '🚧', block_color: 'orange_background' },
          content: ['c1']
        },
        { id: 'cl', type: 'column_list', content: ['k1', 'k2'] },
        { id: 't', type: 'to_do', properties: { title: [['Done']], checked: [['Yes']] } }
      ],
      [
        { id: 'c1', type: 'text', properties: { title: [['Careful']] } },
        { id: 'k1', type: 'column', format: { column_ratio: 0.25 }, content: ['p1'] },
        { id: 'k2', type: 'column', format: { column_ratio: 0.75 }, content: ['p2'] },
        { id: 'p1', type: 'text', properties: { title: [['A']] } },
        { id: 'p2', type: 'text', properties: { title: [['B']] } }
      ]
    )
    const markdown = blocksToMarkdown(mapNotionPaste({ records: json }, context()))
    expect(markdown).toContain('> [!callout:orange_bg] 🚧\n> Careful')
    expect(markdown).toContain('<div data-column data-width="0.5">')
    expect(markdown).toContain('<div data-column data-width="1.5">')
    expect(markdown).toContain('- [x] Done')
  })

  it('leaves a note for an uploaded image Notion gives no address for', () => {
    const json = records([
      {
        id: 'i',
        type: 'image',
        properties: { source: [['attachment:abc:photo.png']], title: [['photo.png']] }
      }
    ])
    const ctx = context()
    expect(blocksToMarkdown(mapNotionPaste({ records: json }, ctx))).toBe(
      '*Image from Notion: photo.png*\n'
    )
    expect(ctx.issues).toEqual(['missingFile: photo.png'])
  })

  it('falls back to the HTML copy without the records', () => {
    const html = '<!-- notionvc: 1 --><h2>Title</h2><ul><li>One</li></ul>'
    expect(blocksToMarkdown(mapNotionPaste({ html }, context()))).toBe('## Title\n\n- One\n')
  })
})

describe('readNotionClipboard', () => {
  const data = (entries: Record<string, string>): Pick<DataTransfer, 'getData' | 'types'> => ({
    types: Object.keys(entries),
    getData: (type: string) => entries[type] ?? ''
  })

  it('recognizes Notion’s records or its HTML marker, and nothing else', () => {
    expect(
      readNotionClipboard(
        data({ 'text/_notion-blocks-v3-production': '{}', 'text/html': '<p>x</p>' })
      )
    ).toEqual({ records: '{}', html: '<p>x</p>' })
    expect(readNotionClipboard(data({ 'text/html': '<p>x</p><!-- notionvc: 1 -->' }))).toEqual({
      html: '<p>x</p><!-- notionvc: 1 -->'
    })
    expect(readNotionClipboard(data({ 'text/html': '<p>x</p>', 'text/plain': 'x' }))).toBeNull()
  })

  it('lists the Notion page ids a copy mentions', () => {
    expect(
      notionPageIds({
        records: '"11111111-2222-3333-4444-555555555555"',
        html: '<a href="https://www.notion.so/X-66666666777788889999aaaaaaaaaaaa">'
      })
    ).toEqual(['11111111222233334444555555555555', '66666666777788889999aaaaaaaaaaaa'])
  })
})
