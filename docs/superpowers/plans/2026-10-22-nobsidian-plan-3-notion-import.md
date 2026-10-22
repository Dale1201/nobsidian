# Nobsidian Plan 3: Notion Import and Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring a Notion workspace into Nobsidian once, with each page looking the same as in Notion, and keep formatting when pasting from Notion.

**Architecture:** A Node worker thread reads Notion's HTML export (zips, zips inside zips, several parts), maps each page to blocks with a pure mapper in `src/shared/notion/`, and stages pages and files in `.nobsidian/import-<time>/`, so nothing in the workspace changes until the end.
The main process then lands the whole tree under a new "Imported from Notion" page in one queued step, with a report page listing anything not converted exactly; cancelling before that leaves nothing behind.
Paste reads Notion's private clipboard records (`text/_notion-blocks-v3-production`) through a second small mapper sharing the same helpers, falling back to its `text/html` copy.

**Tech Stack:** As plans 1 and 2 (Electron 44, electron-vite 6, React 19, TypeScript 7, BlockNote 0.56, zustand, Vitest 5, Playwright 1.64), plus `hast-util-from-html` 2 (HTML to hast, on parse5) and `yauzl` 3 (streaming zip reader with promise APIs); `yazl` 3 builds zips in tests.

**Spec:** `docs/superpowers/specs/2026-10-21-nobsidian-design.md`, section 7 (and the `notionId` field in section 5, testing in section 10).

This is plan 3 of 3.

## How this plan was made

Every task below was built and verified in a scratch prototype, then replayed task by task in a fresh clone of `main`, running the task's checks at each step: each task's new tests fail first for the reason given, then pass.
In the replay `pnpm typecheck` and `pnpm lint` are clean after every task, the unit tests grow from 178 to 234, and the end-to-end suite grows from 46 to 52 tests; the new end-to-end tests passed 60 consecutive runs (`--repeat-each=10`), and the packaged app imports the fixture with its worker running from inside the app archive.
So the code blocks are known-good; the TDD steps still run each test red, then green, to prove the wiring in the real repo.

The design came from a spike and a real export:

- Dale's test page in Notion (every block type and color, sub-pages with clashing titles, an uploaded image and PDF, a synced block, mentions and a database) was exported as HTML and copied to the clipboard.
- The export showed child folders are named without Notion's id (`Child page/`), so siblings with the same title share a folder: the page tree comes from each page's links to its sub-pages, not from folders.
  It also showed `data-notion-*` attributes, Notion calling its green `teal`, every numbered list item written as its own `<ol start>`, and a `Private & Shared/` wrapper folder.
- The clipboard spike showed Notion's `text/html` copy is generated from Markdown and loses colors, underline, callouts, toggles and columns, while its private records keep everything except mention titles (taken from the HTML copy) and uploaded files (Notion gives no address for them).
  It also showed a copied synced block carries only its container; its content is recovered from the HTML copy.
- Reading Notion's private clipboard type in our renderer's paste event works with the real system clipboard; the end-to-end test writes it the way Chromium stores it.

## Before you start

The fixtures are committed with this plan, scrubbed of personal data (names and Notion user and workspace ids replaced):

- `tests/fixtures/notion-export.zip`: the HTML export of the test page.
- `tests/fixtures/notion-clipboard/page.html` and `records.json`: the `text/html` and private-records formats Notion put on the clipboard when the same page was copied.
- `tests/fixtures/web-image.png`: what the end-to-end tests serve in place of the export's web images.

The export's breadcrumb, button and inline database blocks and an uploaded page icon could not be added to the test page, so their mapping is covered with Notion's HTML in unit tests; the import of Dale's real workspace is the final check for them.

## Global Constraints

- Everything in plans 1 and 2's Global Constraints still applies (macOS arm64, Node 24 via `.nvmrc` (`source ~/.nvm/nvm.sh && nvm use 24`), pnpm 10, ESM-only `@blocknote/core`, renderer sandboxing and CSP, GPL-3.0-or-later, Prettier and ESLint clean, explicit return types).
- `hast-util-from-html` and `yauzl` go in `dependencies` (the main process and its worker load them at runtime and electron-builder packages them); `@types/hast`, `@types/yauzl`, `yazl` and `@types/yazl` in `devDependencies`.
- `src/shared/notion/` stays free of Node, Electron and DOM APIs: the worker and the renderer both run it.
- Only the main process and the import worker touch the filesystem; the worker writes only inside its staging folder, and never uses a zip entry's name as a path on disk.
- Nothing an import does is visible in the workspace before landing; landing runs as one task on the `Workspace` queue.
- Text from Notion is never dropped: anything unrecognized becomes plain text and a report entry.
- End-to-end tests launch the app through `e2e/launch.ts` (hidden, `NOBSIDIAN_E2E=1`), never touch the network (web images come from a local server via `NOBSIDIAN_E2E_WEB`), and wait on app state, never on fixed sleeps.
- Comments are rare and short: only invariants, wire-format constraints, or surprising decisions.
- Never use the em dash character in code, docs or commit messages.
- Never run `git commit` without Dale's explicit permission; never add an agent co-author line.

## Review Focus

Inputs a person will hit, with the test that pins each one:

1. **Two sibling pages with the same title, each with sub-pages**: Notion puts both pages' children in one folder; each child must land under the right parent.
   Pinned by "tells apart same-titled siblings that share a folder by their links" in Task 2 and the fixture tree test in Task 3.
2. **Cancelling, quitting or crashing mid-import**: the workspace must not gain half an import, and leftover staging must go.
   Pinned by "cancels before landing and deletes the staging folder" (Task 5), "is removed when discarded, and leftovers are removed on maintenance" (Task 4) and the end-to-end "cancelling an import leaves nothing behind" (Task 6).
3. **Importing twice**: the second import must land beside the first, with attachment names that do not overwrite the first import's files.
   Pinned by "lands a second import beside the first, with its own attachment names" (Task 4) and its end-to-end twin (Task 6).
4. **A Markdown export, a random zip, or an export missing parts**: refused with a clear message, or imported with every missing file and outside link in the report.
   Pinned by "refuses a Markdown export and a zip that is not from Notion" and "reports links to pages outside the export and files missing from it" (Task 3).
5. **The app's own import seen by the file watcher**: landing must not look like edits made outside the app.
   Pinned by "does not treat its own files as edits made outside the app" (Task 4).
6. **A Notion id made only of digits**: YAML would read it as a number; it must be written quoted and still found when pasting links.
   Pinned by "finds imported pages by their Notion id, quoted or not" (Task 4).

---

## File Map

| Path | Responsibility |
|---|---|
| `src/shared/notion/{types,colors,hast,inline,html}.ts` | Mapper from Notion's export HTML (a hast tree) to blocks: colors, rich text, blocks, databases, report issues |
| `src/shared/notion/{records,paste}.ts` | Mapper from Notion's private clipboard records to blocks; reading and mapping a Notion paste |
| `src/main/import/{types,zip,tree,download}.ts` | Manifest and worker message types; reading zips (nested, multi-part); the page tree; image downloads |
| `src/main/import/pipeline.ts` | `runImport`: export to staged pages, files and issues |
| `src/main/import/{worker,start-worker,service}.ts` | The worker thread; `ImportService` (start, progress, cancel, one at a time) |
| `src/main/workspace/page-import.ts`, `workspace.ts` | Staging folders, landing a manifest, the report page, finding pages by Notion id |
| `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` | Import status types, import and paste channels, dropped files' paths |
| `src/main/{handlers,index,menu}.ts` | IPC handlers, File > Import from Notion, the quit prompt |
| `src/renderer/src/components/{ImportPanel,ImportDrop,Modal}.tsx`, `store.ts`, `App.tsx`, `styles/app.css` | Progress panel, drop target and dialog, import state |
| `src/renderer/src/editor/{Editor,attachFiles,notionPaste}.ts(x)`, `components/PageEditor.tsx` | Paste handler, attaching dropped files, preparing a Notion paste |
| `src/renderer/src/editor/editor.css` | Notion's look for links, inline code and dividers |
| `tests/fixtures/` | The export and clipboard fixtures and the reviewed output they must produce |
| `e2e/{import,look}.spec.ts`, `e2e-packaged/packaged.spec.ts` | End-to-end tests for import, paste and the look, and the packaged import |

---

### Task 1: Notion export HTML to blocks

The pure mapper from one page of Notion's HTML export, parsed into a hast tree, to Nobsidian blocks: title, icon, cover, database row properties, and every block type, color and inline style the spec lists.
References are resolved through a `MapContext`, so the caller decides what a link or file becomes, and anything not converted exactly is reported through it.

**Files:**
- Create: `src/shared/notion/colors.ts`, `src/shared/notion/hast.ts`, `src/shared/notion/html.ts`, `src/shared/notion/inline.ts`, `src/shared/notion/types.ts`
- Test: `src/shared/notion/html.test.ts`

**Interfaces:**
- Consumes: plan 1's `Block` types, `normalizeInline`, `isExternalHref`, `pageIdFromHref`, `DEFAULT_CALLOUT_ICON`.
- Produces: `mapNotionPage(root: Root, ctx: MapContext): MappedPage`, `mapNotionFragment(root: Root, ctx: MapContext): Block[]`, `mapBlocks(nodes, ctx)` in `html.ts`; `mapInline(nodes, ctx): Inline[]`; `notionColor(value): BlockColors`, `colorFromClasses(classes, prefix)`; hast helpers `isElement`, `classes`, `hasClass`, `attr`, `elements`, `find`, `findAll`, `textOf`; in `types.ts`: `ISSUE_KINDS` (kind to report heading), `type IssueKind`, `interface Issue`, `interface MapContext { link(href, pageId?): string; file(src): string; issue(kind, detail): void }`, `type NotionIcon = { emoji: string } | { src: string }`, `interface MappedPage { title; icon?; cover?; properties: { name; value: Inline[] }[]; blocks }`.

- [ ] **Step 1: Add the HTML parser**

Run: `pnpm add hast-util-from-html@^2.0.3 && pnpm add -D @types/hast@^3.0.5`
Expected: `package.json` lists `"hast-util-from-html": "^2.0.3"` under `dependencies` and `"@types/hast": "^3.0.5"` under `devDependencies`.

- [ ] **Step 2: Write the failing tests**

Create `src/shared/notion/html.test.ts`:

````ts
import { fromHtml } from 'hast-util-from-html'
import { describe, expect, it } from 'vitest'
import { blocksToMarkdown } from '../core/serialize'
import { notionColor } from './colors'
import { mapNotionFragment, mapNotionPage } from './html'
import type { MapContext } from './types'

function context(): MapContext & { issues: string[] } {
  const issues: string[] = []
  return {
    issues,
    link: (href, pageId) => (pageId ? `nobsidian://page/${pageId}` : href),
    file: (src) => `/attachments/${src.split('/').pop()}`,
    issue: (kind, detail) => issues.push(`${kind}: ${detail}`)
  }
}

function md(html: string, ctx = context()): string {
  return blocksToMarkdown(mapNotionFragment(fromHtml(html, { fragment: true }), ctx))
}

/** Table Markdown without its column padding. */
function unpadded(markdown: string): string {
  return markdown.replace(/ {2,}/g, ' ').replace(/-{3,}/g, '---')
}

describe('notionColor', () => {
  it('reads text and background colors, and calls teal green', () => {
    expect(notionColor('red')).toEqual({ textColor: 'red' })
    expect(notionColor('yellow_background')).toEqual({ backgroundColor: 'yellow' })
    expect(notionColor('teal')).toEqual({ textColor: 'green' })
    expect(notionColor('teal_background')).toEqual({ backgroundColor: 'green' })
    expect(notionColor('default')).toEqual({})
    expect(notionColor(undefined)).toEqual({})
  })
})

describe('mapNotionPage', () => {
  it('reads the title, emoji icon and cover from the header', () => {
    const page = mapNotionPage(
      fromHtml(
        '<article><header><img class="page-cover-image" src="cover.png">' +
          '<div class="page-header-icon"><span class="icon" data-emoji="🧪"></span></div>' +
          '<h1 class="page-title">Plans: 2026</h1></header><div class="page-body"><p>Hi</p></div></article>'
      ),
      context()
    )
    expect(page.title).toBe('Plans: 2026')
    expect(page.icon).toEqual({ emoji: '🧪' })
    expect(page.cover).toBe('/attachments/cover.png')
    expect(blocksToMarkdown(page.blocks)).toBe('Hi\n')
  })

  it('reads an image icon and a database row’s properties', () => {
    const page = mapNotionPage(
      fromHtml(
        '<header><div class="page-header-icon"><img class="icon" src="Row/icon.png"></div>' +
          '<h1 class="page-title">Row</h1><table class="properties"><tbody>' +
          '<tr class="property-row"><th><span class="icon property-icon"><img src="x.svg"></span>Status</th>' +
          '<td><span class="selected-value select-value-color-green">Done</span></td></tr>' +
          '</tbody></table></header><div class="page-body"></div>'
      ),
      context()
    )
    expect(page.icon).toEqual({ src: '/attachments/icon.png' })
    expect(page.properties).toEqual([
      {
        name: 'Status',
        value: [{ type: 'text', text: 'Done', styles: { backgroundColor: 'green' } }]
      }
    ])
  })
})

describe('mapNotionFragment', () => {
  it('keeps inline styles, colors and inline math', () => {
    expect(
      md(
        '<p><strong>b</strong> <em>i</em> <span style="border-bottom:0.05em solid">u</span> ' +
          '<del>s</del> <code>c</code> <mark class="highlight-red">red</mark> ' +
          '<mark data-notion-highlight="teal_background">green</mark> ' +
          '<span data-notion-inline-equation="x^2" class="notion-text-equation-token"><span>x2</span></span></p>'
      )
    ).toBe(
      '**b** *i* <u>u</u> ~~s~~ `c` <span data-color="red">red</span> <span data-bg="green">green</span> $x^2$\n'
    )
  })

  it('maps block colors, an empty paragraph and every heading level', () => {
    expect(
      md(
        '<p class="block-color-blue">Blue</p><p>\n</p><h1>One</h1><h4>Four</h4>' +
          '<h3 class="block-color-purple_background">Bg</h3>'
      )
    ).toBe('Blue<!-- color=blue -->\n\n&nbsp;\n\n# One\n\n#### Four\n\n### Bg<!-- bg=purple -->\n')
  })

  it('joins numbered items Notion writes as separate lists', () => {
    expect(
      md(
        '<ol class="numbered-list" start="1"><li>One</li></ol>' +
          '<ol class="numbered-list" start="2"><li>Two<ol class="numbered-list" start="1"><li>Inner</li></ol></li></ol>' +
          '<ol class="numbered-list" start="3"><li>Three</li></ol>'
      )
    ).toBe('1. One\n2. Two\n   1. Inner\n3. Three\n')
  })

  it('keeps a list that starts at another number', () => {
    expect(md('<p>Intro</p><ol class="numbered-list" start="4"><li>Four</li></ol>')).toBe(
      'Intro\n\n4. Four\n'
    )
  })

  it('maps to-dos with their nested items', () => {
    expect(
      md(
        '<ul class="to-do-list"><li><input type="checkbox" class="checkbox checkbox-on" checked> ' +
          '<span class="to-do-children-checked">Done</span><div class="indented">' +
          '<ul class="to-do-list"><li><input type="checkbox" class="checkbox checkbox-off"> ' +
          '<span class="to-do-children-unchecked">Open</span><div class="indented"></div></li></ul>' +
          '</div></li></ul>'
      )
    ).toBe('- [x] Done\n  - [ ] Open\n')
  })

  it('maps toggles and toggle headings', () => {
    expect(
      md(
        '<details class="toggle"><summary>Title</summary><div class="indented"><p>Inside</p></div></details>' +
          '<details><summary><h2>Big</h2></summary><div class="indented"><p>Under</p></div></details>'
      )
    ).toBe(
      '<details>\n<summary>Title</summary>\n\nInside\n\n</details>\n\n' +
        '<details data-heading="2">\n<summary>Big</summary>\n\nUnder\n\n</details>\n'
    )
  })

  it('maps quotes with children and callouts with their icon and color', () => {
    expect(
      md(
        '<blockquote class="block-color-teal_background">Quote<p>Child</p></blockquote>' +
          '<aside class="callout" data-notion-callout-icon="🚧" data-notion-callout-background="orange_background">' +
          '<div><span class="icon" data-emoji="🚧"></span></div><div style="width:100%"><p>Careful</p>' +
          '<ul class="bulleted-list"><li>Item</li></ul></div></aside>'
      )
    ).toBe(
      '> Quote<!-- bg=green -->\n>\n> Child\n\n> [!callout:orange_bg] 🚧\n> Careful\n>\n> - Item\n'
    )
  })

  it('maps code, equations, dividers and the table of contents', () => {
    expect(
      md(
        '<pre class="code" data-notion-code-syntax="Python"><code class="language-python">print(1)</code></pre>' +
          '<figure class="equation" data-notion-equation="a+b"><span class="katex">a+b</span></figure>' +
          '<hr><nav class="table_of_contents"><a href="#x">X</a></nav>'
      )
    ).toBe('```python\nprint(1)\n```\n\n$$\na+b\n$$\n\n---\n\n<nav data-toc></nav>\n')
  })

  it('maps images, files, bookmarks and embeds', () => {
    expect(
      md(
        '<figure class="image"><a href="Page/a%20b.png"><img src="Page/a%20b.png"></a><figcaption>Cap</figcaption></figure>' +
          '<figure><div class="source"><a href="Page/r.pdf" data-notion-file="Page/r.pdf" data-notion-file-alias="r.pdf">r.pdf</a></div></figure>' +
          '<figure><a href="https://w.org" class="bookmark source"><div class="bookmark-title">W</div></a></figure>' +
          '<figure><div class="source"><a href="https://youtu.be/x">https://youtu.be/x</a></div></figure>'
      )
    ).toBe(
      '![Cap](/attachments/a%20b.png)\n\n[r.pdf](/attachments/r.pdf "file")\n\n[W](https://w.org)\n\n<https://youtu.be/x>\n'
    )
  })

  it('maps columns with their widths', () => {
    expect(
      md(
        '<div class="column-list"><div class="column" data-notion-column-ratio="0.25"><p>A</p></div>' +
          '<div class="column" style="width:75%"><p>B</p></div></div>'
      )
    ).toBe(
      '<div data-columns>\n\n<div data-column data-width="0.5">\n\nA\n\n</div>\n\n' +
        '<div data-column data-width="1.5">\n\nB\n\n</div>\n\n</div>\n'
    )
  })

  it('turns sub-page links into page blocks, or plain links when the page is not imported', () => {
    const ctx = context()
    ctx.link = (href, pageId) => (pageId === 'a' ? 'nobsidian://page/a' : href)
    expect(
      md(
        '<figure class="link-to-page"><a href="A.html" data-notion-page-id="a"><span class="icon"></span>A</a></figure>' +
          '<figure class="link-to-page"><a href="https://www.notion.so/b" data-notion-page-id="b">B</a></figure>',
        ctx
      )
    ).toBe('[a](nobsidian://page/a "page")\n\n[B](https://www.notion.so/b)\n')
  })

  it('keeps the content of synced blocks and color wrappers', () => {
    expect(
      md(
        '<div><p>Synced</p></div><div data-notion-highlight="red"><ul class="block-color-red bulleted-list"><li>R</li></ul></div>'
      )
    ).toBe('Synced\n\n- R<!-- color=red -->\n')
  })

  it('maps a database view, keeping pill colors and checkboxes', () => {
    expect(
      unpadded(
        md(
          '<div class="collection-content-wrapper"><table class="collection-content"><thead><tr>' +
            '<th><span class="icon property-icon"><img src="i.svg"></span>Name</th><th>Tags</th><th>Done</th></tr></thead>' +
            '<tbody><tr><td class="cell-title"><a href="Db/Row.html" data-notion-page-id="r">Row</a></td>' +
            '<td><span class="selected-value select-value-color-brown">a</span><span class="selected-value select-value-color-purple">b</span></td>' +
            '<td><input type="checkbox" class="checkbox checkbox-on" checked></td></tr></tbody></table></div>'
        )
      )
    ).toBe(
      '| Name | Tags | Done |\n| --- | --- | --- |\n' +
        '| [Row](nobsidian://page/r) | <span data-bg="brown">a</span> <span data-bg="purple">b</span> | ☑ |\n'
    )
  })

  it('maps an inline database with its title', () => {
    expect(
      unpadded(
        md(
          '<div class="collection-content"><h4 class="collection-title">Tasks</h4>' +
            '<table class="collection-content"><thead><tr><th>Name</th></tr></thead>' +
            '<tbody><tr><td class="cell-title"><a href="Tasks/Write.html" data-notion-page-id="w">Write</a></td></tr>' +
            '</tbody></table></div>'
        )
      )
    ).toBe('### Tasks\n\n| Name |\n| --- |\n| [Write](nobsidian://page/w) |\n')
  })

  it('reports table formatting Markdown cannot keep', () => {
    const ctx = context()
    md(
      '<table class="simple-table"><thead><tr><th>A</th><th>B</th></tr></thead><tbody>' +
        '<tr><th>C</th><td class="block-color-red_background">D</td></tr></tbody></table>',
      ctx
    )
    expect(ctx.issues).toEqual([
      'table: Header column (kept as a normal column)',
      'table: Table cell colors'
    ])
  })

  it('keeps the text of blocks it does not know, and reports them', () => {
    const ctx = context()
    expect(
      md('<section class="mystery">Some text</section><nav class="breadcrumb"></nav>', ctx)
    ).toBe('Some text\n')
    expect(ctx.issues).toEqual(['unknown: section.mystery', 'skipped: nav.breadcrumb'])
  })
})
````

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm exec vitest run src/shared/notion`
Expected: FAIL with "Cannot find module './colors'".

- [ ] **Step 4: Write the implementation**

Create `src/shared/notion/colors.ts`:

```ts
import { COLOR_NAMES, type BlockColors, type ColorName } from '../core/blocks'

const NAMES = new Set<string>(COLOR_NAMES)

/** Notion's color names ("red", "red_background", "teal") as text or background colors. */
export function notionColor(value: string | undefined): BlockColors {
  if (!value) return {}
  const background = value.endsWith('_background') || value.endsWith('_bg')
  const base = value.replace(/_(background|bg)$/, '')
  // Notion calls its green "teal" internally.
  const name = base === 'teal' ? 'green' : base
  if (!NAMES.has(name)) return {}
  return background ? { backgroundColor: name as ColorName } : { textColor: name as ColorName }
}

/** The color in a `block-color-<c>`, `highlight-<c>` or `select-value-color-<c>` class list. */
export function colorFromClasses(classes: string[], prefix: string): BlockColors {
  for (const c of classes) if (c.startsWith(prefix)) return notionColor(c.slice(prefix.length))
  return {}
}
```

Create `src/shared/notion/hast.ts`:

```ts
import type { Element, ElementContent, Root, RootContent } from 'hast'

export type Node = Root | RootContent | ElementContent

export function isElement(node: Node | undefined): node is Element
export function isElement(node: Node | undefined, tag: string): boolean
export function isElement(node: Node | undefined, tag?: string): boolean {
  return node?.type === 'element' && (tag === undefined || node.tagName === tag)
}

export function classes(el: Element): string[] {
  const value: unknown = el.properties.className
  return Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(' ')
      : []
}

export function hasClass(el: Element, name: string): boolean {
  return classes(el).includes(name)
}

/** An attribute by its HTML name (`data-notion-page-id`), whatever hast calls the property. */
export function attr(el: Element, name: string): string | undefined {
  const key = name.startsWith('data-')
    ? 'data' + name.slice(4).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    : name
  const value = el.properties[key]
  if (value === undefined || value === null || value === false) return undefined
  return Array.isArray(value) ? value.join(' ') : String(value)
}

export function elements(node: Element | Root): Element[] {
  const children: RootContent[] = node.children
  return children.filter((c): c is Element => c.type === 'element')
}

export function find(node: Node, test: (el: Element) => boolean): Element | undefined {
  if (isElement(node) && test(node)) return node
  if ('children' in node) {
    for (const child of node.children) {
      const hit = find(child, test)
      if (hit) return hit
    }
  }
  return undefined
}

export function findAll(
  node: Node,
  test: (el: Element) => boolean,
  out: Element[] = []
): Element[] {
  if (isElement(node) && test(node)) out.push(node)
  if ('children' in node) for (const child of node.children) findAll(child, test, out)
  return out
}

export function textOf(node: Node): string {
  if (node.type === 'text') return node.value
  if (isElement(node, 'br')) return '\n'
  if ('children' in node) return node.children.map(textOf).join('')
  return ''
}
```

Create `src/shared/notion/html.ts`:

```ts
import type { Element, ElementContent, Root } from 'hast'
import type { Block, BlockColors, Inline, TableContent } from '../core/blocks'
import { DEFAULT_CALLOUT_ICON } from '../core/blocks'
import { isExternalHref } from '../core/paths'
import { pageIdFromHref } from '../core/links'
import { colorFromClasses, notionColor } from './colors'
import { attr, classes, elements, find, hasClass, isElement, textOf } from './hast'
import { isInlineNode, mapInline } from './inline'
import type { MapContext, MappedPage, NotionIcon } from './types'

/** One page of Notion's HTML export: title, icon, cover, database properties and blocks. */
export function mapNotionPage(root: Root, ctx: MapContext): MappedPage {
  const header = find(root, (el) => el.tagName === 'header')
  const body = find(root, (el) => hasClass(el, 'page-body'))
  const titleEl = header && find(header, (el) => hasClass(el, 'page-title'))
  const properties = header ? mapProperties(header, ctx) : []
  return {
    title: titleEl ? textOf(titleEl).trim() : '',
    icon: header ? pageIcon(header, ctx) : undefined,
    cover: header ? pageCover(header, ctx) : undefined,
    properties,
    blocks: body ? mapBlocks(body.children, ctx) : []
  }
}

/** Blocks of an HTML fragment, such as Notion's `text/html` clipboard copy. */
export function mapNotionFragment(root: Root, ctx: MapContext): Block[] {
  const body = find(root, (el) => el.tagName === 'body') ?? root
  return mapBlocks(body.children as ElementContent[], ctx)
}

function pageIcon(header: Element, ctx: MapContext): NotionIcon | undefined {
  const box = find(header, (el) => hasClass(el, 'page-header-icon'))
  if (!box) return undefined
  const emoji = find(box, (el) => attr(el, 'data-emoji') !== undefined)
  if (emoji) return { emoji: attr(emoji, 'data-emoji')! }
  const img = find(box, (el) => el.tagName === 'img')
  const src = img && attr(img, 'src')
  if (src) return { src: ctx.file(src) }
  const text = textOf(box).trim()
  return text ? { emoji: text } : undefined
}

function pageCover(header: Element, ctx: MapContext): string | undefined {
  const img = find(header, (el) => hasClass(el, 'page-cover-image'))
  const src = img && attr(img, 'src')
  return src ? ctx.file(src) : undefined
}

function mapProperties(header: Element, ctx: MapContext): MappedPage['properties'] {
  const table = find(header, (el) => el.tagName === 'table' && hasClass(el, 'properties'))
  if (!table) return []
  return findRows(table).map((row) => {
    const [name, value] = elements(row)
    return {
      name: name ? textOf(name).trim() : '',
      value: value ? cellInline(value, ctx) : []
    }
  })
}

// ---------- blocks ----------

export function mapBlocks(nodes: ElementContent[], ctx: MapContext): Block[] {
  const out: Block[] = []
  let loose: ElementContent[] = []
  const flush = (): void => {
    const content = mapInline(loose, ctx)
    loose = []
    if (content.some((c) => c.type !== 'text' || c.text.trim() !== '')) {
      out.push(paragraph(content))
    }
  }
  for (const node of nodes) {
    if (isInlineNode(node)) {
      loose.push(node)
      continue
    }
    flush()
    if (isElement(node)) out.push(...mapElement(node, ctx))
  }
  flush()
  return joinNumberedLists(out)
}

/** Notion writes every numbered item as its own `<ol start>`; only a list's first item keeps it. */
function joinNumberedLists(blocks: Block[]): Block[] {
  return blocks.map((block, i) => {
    if (block.type !== 'numberedListItem' || blocks[i - 1]?.type !== 'numberedListItem')
      return block
    const props = { ...block.props }
    delete props.start
    return { ...block, props }
  })
}

function mapElement(el: Element, ctx: MapContext): Block[] {
  const colors = blockColors(el)
  switch (el.tagName) {
    case 'p':
      return [paragraph(trimEmpty(mapInline(el.children, ctx)), colors)]
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return [heading(Number(el.tagName[1]), mapInline(el.children, ctx), colors)]
    case 'ul':
    case 'ol':
      return mapList(el, ctx)
    case 'details':
      return [mapToggle(el, ctx)]
    case 'blockquote':
      return [mapQuote(el, ctx)]
    case 'aside':
      return [mapCallout(el, ctx)]
    case 'hr':
      return [{ type: 'divider', props: {}, children: [] }]
    case 'pre':
      return [mapCode(el)]
    case 'figure':
      return mapFigure(el, ctx)
    case 'table':
      return [mapTable(el, ctx)]
    case 'nav':
      if (hasClass(el, 'table_of_contents') || attr(el, 'data-notion-toc') !== undefined) {
        return [{ type: 'toc', props: {}, children: [] }]
      }
      return skipped(el, ctx)
    case 'div':
      return mapDiv(el, ctx)
    case 'img':
      return [image(ctx.file(attr(el, 'src') ?? ''), '')]
    case 'video':
    case 'audio': {
      const src =
        attr(el, 'src') ??
        attr(
          find(el, (e) => e.tagName === 'source')!,
          'src'
        ) ??
        ''
      return [{ type: el.tagName, props: { url: ctx.file(src), caption: '' }, children: [] }]
    }
    case 'script':
    case 'style':
    case 'link':
    case 'meta':
      return []
    default:
      return unknown(el, ctx)
  }
}

function blockColors(el: Element): BlockColors {
  const color = notionColor(attr(el, 'data-notion-highlight'))
  return Object.keys(color).length ? color : colorFromClasses(classes(el), 'block-color-')
}

function paragraph(content: Inline[], colors: BlockColors = {}): Block {
  return { type: 'paragraph', props: { ...colors }, content, children: [] }
}

function heading(level: number, content: Inline[], colors: BlockColors = {}): Block {
  return { type: 'heading', props: { level, ...colors }, content, children: [] }
}

/** Notion writes an empty paragraph as a newline. */
function trimEmpty(content: Inline[]): Inline[] {
  return content.length === 1 && content[0].type === 'text' && content[0].text.trim() === ''
    ? []
    : content
}

function mapList(el: Element, ctx: MapContext): Block[] {
  const listColors = blockColors(el)
  const ordered = el.tagName === 'ol'
  const todo = hasClass(el, 'to-do-list')
  const start = Number(attr(el, 'start') ?? '1')
  return elements(el)
    .filter((li) => li.tagName === 'li')
    .map((li, i): Block => {
      const { content, children } = splitItem(li, ctx)
      const colors = { ...listColors, ...blockColors(li) }
      if (todo) {
        const box = find(li, (e) => e.tagName === 'input')
        const checked = box
          ? hasClass(box, 'checkbox-on') || attr(box, 'checked') !== undefined
          : false
        return { type: 'checkListItem', props: { checked, ...colors }, content, children }
      }
      if (ordered) {
        const props = i === 0 && start !== 1 ? { start, ...colors } : { ...colors }
        return { type: 'numberedListItem', props, content, children }
      }
      return { type: 'bulletListItem', props: colors, content, children }
    })
}

/** A list item's own text, then its nested blocks (nested lists or an `indented` div). */
function splitItem(li: Element, ctx: MapContext): { content: Inline[]; children: Block[] } {
  const own: ElementContent[] = []
  const nested: ElementContent[] = []
  for (const node of li.children) {
    if (isElement(node, 'input')) continue
    if (isElement(node) && hasClass(node, 'indented')) nested.push(...node.children)
    else if (nested.length === 0 && isInlineNode(node)) own.push(node)
    else nested.push(node)
  }
  return { content: trimEdges(mapInline(own, ctx)), children: mapBlocks(nested, ctx) }
}

function trimEdges(content: Inline[]): Inline[] {
  const first = content[0]
  if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '')
  const last = content[content.length - 1]
  if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '')
  return content.filter((c) => c.type !== 'text' || c.text !== '')
}

function mapToggle(el: Element, ctx: MapContext): Block {
  const summary = elements(el).find((c) => c.tagName === 'summary')
  const body = elements(el).find((c) => hasClass(c, 'indented'))
  const children = body ? mapBlocks(body.children, ctx) : []
  const colors = blockColors(el)
  const head = summary && elements(summary).find((c) => /^h[1-6]$/.test(c.tagName))
  if (head) {
    const block = heading(Number(head.tagName[1]), mapInline(head.children, ctx), colors)
    return { ...block, props: { ...block.props, isToggleable: true }, children } as Block
  }
  const content = summary ? mapInline(summary.children, ctx) : []
  return { type: 'toggleListItem', props: colors, content, children }
}

function mapQuote(el: Element, ctx: MapContext): Block {
  const own: ElementContent[] = []
  let rest: ElementContent[] = []
  for (const node of el.children) {
    if (rest.length === 0 && isInlineNode(node)) own.push(node)
    else rest.push(node)
  }
  let content = trimEdges(mapInline(own, ctx))
  // Exports from the clipboard put the quote's text in its first paragraph.
  if (content.length === 0 && isElement(rest[0], 'p')) {
    content = mapInline((rest[0] as Element).children, ctx)
    rest = rest.slice(1)
  }
  return { type: 'quote', props: blockColors(el), content, children: mapBlocks(rest, ctx) }
}

function mapCallout(el: Element, ctx: MapContext): Block {
  const iconBox = elements(el)[0]
  const emoji =
    attr(el, 'data-notion-callout-icon') ??
    (iconBox &&
      attr(find(iconBox, (e) => attr(e, 'data-emoji') !== undefined) ?? iconBox, 'data-emoji'))
  const iconImage = !emoji && iconBox ? find(iconBox, (e) => e.tagName === 'img') : undefined
  if (iconImage) ctx.issue('skipped', 'Callout image icon (shown as 💡)')
  const body = elements(el).find((c) => attr(c, 'style')?.includes('width:100%')) ?? elements(el)[1]
  const blocks = body ? mapBlocks(body.children, ctx) : []
  const background = attr(el, 'data-notion-callout-background')
  const colors = background ? notionColor(background) : blockColors(el)
  const first = blocks[0]
  const lead = first?.type === 'paragraph' && Object.keys(first.props).length === 0 ? first : null
  return {
    type: 'callout',
    props: { icon: emoji ?? DEFAULT_CALLOUT_ICON, ...calloutColors(colors) },
    content: lead ? lead.content : [],
    children: [...(lead ? lead.children : []), ...blocks.slice(lead ? 1 : 0)]
  }
}

/** A callout always has a background in Nobsidian; Notion's plain callouts are gray. */
function calloutColors(colors: BlockColors): BlockColors {
  return colors.backgroundColor || colors.textColor ? colors : { backgroundColor: 'gray' }
}

function mapCode(el: Element): Block {
  const code = find(el, (e) => e.tagName === 'code') ?? el
  const fromClass = classes(code)
    .find((c) => c.startsWith('language-'))
    ?.slice('language-'.length)
  const language = attr(el, 'data-notion-code-syntax') ?? fromClass ?? 'text'
  const text = textOf(code)
  return {
    type: 'codeBlock',
    props: { language: language.toLowerCase() },
    content: text ? [{ type: 'text', text, styles: {} }] : [],
    children: []
  }
}

function mapFigure(el: Element, ctx: MapContext): Block[] {
  const caption = elements(el).find((c) => c.tagName === 'figcaption')
  const captionText = caption ? textOf(caption).trim() : ''
  if (hasClass(el, 'equation')) {
    const latex =
      attr(el, 'data-notion-equation') ??
      textOf(find(el, (e) => e.tagName === 'annotation') ?? el).trim()
    return [{ type: 'math', props: { latex }, children: [] }]
  }
  if (hasClass(el, 'image') || attr(el, 'data-notion-image') !== undefined) {
    const img = find(el, (e) => e.tagName === 'img')
    const src = (img && attr(img, 'src')) ?? decodeURI(attr(el, 'data-notion-image') ?? '')
    return [image(ctx.file(src), captionText)]
  }
  if (hasClass(el, 'link-to-page')) return [pageLinkBlock(el, ctx)]
  if (hasClass(el, 'callout')) return [mapCallout(el, ctx)]
  const bookmark = find(el, (e) => e.tagName === 'a' && hasClass(e, 'bookmark'))
  if (bookmark) {
    const href = attr(bookmark, 'href') ?? ''
    const titleEl = find(bookmark, (e) => hasClass(e, 'bookmark-title'))
    const title = (titleEl && textOf(titleEl).trim()) || href
    return [linkParagraph(href, title, ctx)]
  }
  const media = find(el, (e) => e.tagName === 'video' || e.tagName === 'audio')
  if (media) return mapElement(media, ctx)
  const source = find(el, (e) => hasClass(e, 'source'))
  const a = source && find(source, (e) => e.tagName === 'a')
  if (a) {
    const href = attr(a, 'data-notion-file') ?? attr(a, 'href') ?? ''
    const local = attr(a, 'data-notion-file') !== undefined || !isExternalHref(href)
    if (local) {
      const name = attr(a, 'data-notion-file-alias') ?? textOf(a).trim()
      const file: Block = {
        type: 'file',
        props: { url: ctx.file(href), name, ...(captionText ? { caption: captionText } : {}) },
        children: []
      }
      return [file]
    }
    const blocks = [linkParagraph(href, textOf(a).trim() || href, ctx)]
    if (captionText) blocks.push(paragraph([{ type: 'text', text: captionText, styles: {} }]))
    return blocks
  }
  return mapBlocks(el.children, ctx)
}

function image(url: string, caption: string): Block {
  return { type: 'image', props: { url, caption }, children: [] }
}

function linkParagraph(href: string, text: string, ctx: MapContext): Block {
  return paragraph([
    { type: 'link', href: ctx.link(href), content: [{ type: 'text', text, styles: {} }] }
  ])
}

function pageLinkBlock(el: Element, ctx: MapContext): Block {
  const a = find(el, (e) => e.tagName === 'a')
  const href = a ? ctx.link(attr(a, 'href') ?? '', attr(a, 'data-notion-page-id')) : ''
  if (pageIdFromHref(href)) return { type: 'pageLink', props: { href }, children: [] }
  // The page is not in the export: keep a plain link to it.
  const text = (a && textOf(a).trim()) || href
  return paragraph([{ type: 'link', href, content: [{ type: 'text', text, styles: {} }] }])
}

function mapDiv(el: Element, ctx: MapContext): Block[] {
  if (hasClass(el, 'column-list') || attr(el, 'data-notion-column-list') !== undefined) {
    const columns = elements(el).filter(
      (c) => hasClass(c, 'column') || attr(c, 'data-notion-column-ratio') !== undefined
    )
    return [
      {
        type: 'columnList',
        props: {},
        children: columns.map((c): Block => ({
          type: 'column',
          props: { width: columnWidth(c, columns.length) },
          children: mapBlocks(c.children, ctx)
        }))
      }
    ]
  }
  if (hasClass(el, 'collection-content') || hasClass(el, 'collection-content-wrapper')) {
    return mapCollection(el, ctx)
  }
  // Synced blocks, color wrappers and other containers: their content, inline.
  return mapBlocks(el.children, ctx)
}

/** Nobsidian column widths are relative weights; Notion's ratios sum to 1. */
function columnWidth(el: Element, count: number): number {
  const ratio = Number(attr(el, 'data-notion-column-ratio'))
  const percent = /width:\s*([\d.]+)%/.exec(attr(el, 'style') ?? '')
  const share = Number.isFinite(ratio) && ratio > 0 ? ratio : percent ? Number(percent[1]) / 100 : 0
  return share ? Math.round(share * count * 1000) / 1000 : 1
}

function mapCollection(el: Element, ctx: MapContext): Block[] {
  const out: Block[] = []
  const title = find(el, (e) => hasClass(e, 'collection-title'))
  if (title) out.push(heading(3, mapInline(title.children, ctx)))
  const table = find(el, (e) => e.tagName === 'table')
  if (table) out.push(mapTable(table, ctx))
  return out
}

// ---------- tables ----------

function findRows(table: Element): Element[] {
  const rows: Element[] = []
  for (const part of elements(table)) {
    if (part.tagName === 'tr') rows.push(part)
    else if (part.tagName === 'thead' || part.tagName === 'tbody' || part.tagName === 'tfoot') {
      rows.push(...elements(part).filter((r) => r.tagName === 'tr'))
    }
  }
  return rows
}

function mapTable(el: Element, ctx: MapContext): Block {
  const rows = findRows(el)
  const database = hasClass(el, 'collection-content')
  let headerColumn = false
  let colored = false
  const content: TableContent = {
    type: 'tableContent',
    rows: rows.map((row) => ({
      cells: elements(row)
        .filter((c) => c.tagName === 'td' || c.tagName === 'th')
        .map((cell) => {
          if (cell.tagName === 'th' && rows.indexOf(row) > 0) headerColumn = true
          if (!database && Object.keys(colorFromClasses(classes(cell), 'block-color-')).length) {
            colored = true
          }
          return cellInline(cell, ctx)
        })
    }))
  }
  if (headerColumn) ctx.issue('table', 'Header column (kept as a normal column)')
  if (colored) ctx.issue('table', 'Table cell colors')
  return { type: 'table', props: {}, content, children: [] }
}

function cellInline(cell: Element, ctx: MapContext): Inline[] {
  const nodes: ElementContent[] = []
  for (const child of cell.children) {
    // Property icons in database headers are decoration.
    if (isElement(child) && hasClass(child, 'property-icon')) continue
    const pill = isElement(child) && hasClass(child, 'selected-value')
    const last = nodes[nodes.length - 1]
    if (pill && isElement(last) && hasClass(last, 'selected-value')) {
      nodes.push({ type: 'text', value: ' ' })
    }
    nodes.push(child as ElementContent)
  }
  return mapInline(nodes, ctx)
}

// ---------- unknown content ----------

function describe(el: Element): string {
  const cls = classes(el).filter((c) => c && !c.startsWith('block-color-'))
  return cls.length ? `${el.tagName}.${cls.join('.')}` : el.tagName
}

function skipped(el: Element, ctx: MapContext): Block[] {
  ctx.issue('skipped', describe(el))
  return []
}

function unknown(el: Element, ctx: MapContext): Block[] {
  const text = textOf(el).trim()
  if (!text) return skipped(el, ctx)
  ctx.issue('unknown', describe(el))
  return text.split(/\n{2,}/).map((t) => paragraph([{ type: 'text', text: t, styles: {} }]))
}
```

Create `src/shared/notion/inline.ts`:

```ts
import type { Element, ElementContent } from 'hast'
import type { Inline, StyledText, Styles } from '../core/blocks'
import { normalizeInline } from '../core/normalize'
import { colorFromClasses, notionColor } from './colors'
import { attr, classes, hasClass, isElement, textOf } from './hast'
import type { MapContext } from './types'

/** Rich text in Notion's export HTML, as Nobsidian inline content. */
export function mapInline(nodes: ElementContent[], ctx: MapContext): Inline[] {
  const out: Inline[] = []
  walk(nodes, {}, out, ctx)
  return normalizeInline(out)
}

function walk(nodes: ElementContent[], styles: Styles, out: Inline[], ctx: MapContext): void {
  for (const node of nodes) {
    if (node.type === 'text') pushText(out, node.value, styles)
    else if (node.type === 'element') element(node, styles, out, ctx)
  }
}

function pushText(out: Inline[], text: string, styles: Styles): void {
  if (text !== '') out.push({ type: 'text', text, styles: { ...styles } })
}

function element(el: Element, styles: Styles, out: Inline[], ctx: MapContext): void {
  const inner = (extra: Styles): void => walk(el.children, { ...styles, ...extra }, out, ctx)
  switch (el.tagName) {
    case 'br':
      return pushText(out, '\n', styles)
    case 'strong':
    case 'b':
      return inner({ bold: true })
    case 'em':
    case 'i':
      return inner({ italic: true })
    case 'del':
    case 's':
      return inner({ strike: true })
    case 'code':
      return inner({ code: true })
    case 'mark': {
      const color = notionColor(attr(el, 'data-notion-highlight'))
      return inner(Object.keys(color).length ? color : colorFromClasses(classes(el), 'highlight-'))
    }
    case 'a':
      return link(el, styles, out, ctx)
    case 'img':
      // Custom emoji and inline icons: keep their name so no text is lost.
      return pushText(out, attr(el, 'alt') ?? '', styles)
    case 'span': {
      const equation = attr(el, 'data-notion-inline-equation')
      if (equation !== undefined || hasClass(el, 'notion-text-equation-token')) {
        const latex = equation ?? textOf(el)
        out.push({ type: 'inlineMath', props: { latex } })
        return
      }
      if (hasClass(el, 'icon')) return
      const underline = /border-bottom:\s*0\.05em solid/.test(attr(el, 'style') ?? '')
      if (hasClass(el, 'selected-value')) {
        return inner(colorAsBackground(colorFromClasses(classes(el), 'select-value-color-')))
      }
      return inner(underline ? { underline: true } : {})
    }
    case 'input':
      if (attr(el, 'type') === 'checkbox') pushText(out, attr(el, 'checked') ? '☑' : '☐', styles)
      return
    default:
      return inner({})
  }
}

/** Select pills are colored backgrounds in Notion, whatever the option's color is called. */
function colorAsBackground(color: { textColor?: string; backgroundColor?: string }): Styles {
  const name = color.textColor ?? color.backgroundColor
  return name ? { backgroundColor: name } : {}
}

function link(el: Element, styles: Styles, out: Inline[], ctx: MapContext): void {
  const href = attr(el, 'href') ?? ''
  const content: Inline[] = []
  walk(el.children, styles, content, ctx)
  const text = content.filter((c): c is StyledText => c.type === 'text')
  if (href === '' || href.startsWith('#')) {
    out.push(...text)
    return
  }
  const target = ctx.link(href, attr(el, 'data-notion-page-id'))
  const label = text.length ? text : [{ type: 'text' as const, text: href, styles: { ...styles } }]
  out.push({ type: 'link', href: target, content: label })
}

export function isInlineNode(node: ElementContent): boolean {
  if (node.type === 'text') return true
  if (!isElement(node)) return false
  return INLINE_TAGS.has(node.tagName)
}

const INLINE_TAGS = new Set([
  'a',
  'b',
  'br',
  'code',
  'del',
  'em',
  'i',
  'img',
  'input',
  'mark',
  's',
  'span',
  'strong',
  'time',
  'sub',
  'sup',
  'u'
])
```

Create `src/shared/notion/types.ts`:

```ts
import type { Block, Inline } from '../core/blocks'

/** Kinds of things the importer could not convert exactly; each becomes a section of the report. */
export const ISSUE_KINDS = {
  skipped: 'Blocks skipped',
  unknown: 'Blocks kept as plain text',
  outsideLink: 'Links to pages outside the export',
  missingFile: 'Files missing from the export',
  download: "External images that couldn't be downloaded",
  table: 'Table formatting not kept',
  failedPage: "Pages that couldn't be converted"
} as const

export type IssueKind = keyof typeof ISSUE_KINDS

export interface Issue {
  kind: IssueKind
  detail: string
}

/** How the mapper turns references in Notion content into Nobsidian hrefs. */
export interface MapContext {
  /** A link's target; `pageId` is Notion's id when the content says which page it is. */
  link(href: string, pageId?: string): string
  /** An image or file reference, relative to the page being mapped or absolute. */
  file(src: string): string
  issue(kind: IssueKind, detail: string): void
}

export type NotionIcon = { emoji: string } | { src: string }

export interface MappedPage {
  title: string
  icon?: NotionIcon
  cover?: string
  /** A database row's properties, in order. */
  properties: { name: string; value: Inline[] }[]
  blocks: Block[]
}
```

- [ ] **Step 5: Run the tests and checks**

Run: `pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: 197 unit tests pass; no type errors; ESLint reports nothing.

- [ ] **Step 6: Commit (ask Dale first)**

```bash
git add package.json pnpm-lock.yaml src/shared/notion/colors.ts src/shared/notion/hast.ts src/shared/notion/html.test.ts src/shared/notion/html.ts src/shared/notion/inline.ts src/shared/notion/types.ts
git commit -m "Map Notion export HTML to blocks"
```


---

### Task 2: Reading the export: zips, page tree, downloads

Opens one or more zips as a single export, following zips inside zips (Notion's `Part-N.zip`), and peeks at a zip's file names to tell an HTML export from a Markdown one or anything else.
Builds the page tree from each page's links to its sub-pages, because Notion names child folders without the page id.
Downloads web images with a timeout and size cap; end-to-end tests point it at a local server.
Also adds the manifest and status types the following tasks share.

**Files:**
- Create: `src/main/import/download.ts`, `src/main/import/tree.ts`, `src/main/import/types.ts`, `src/main/import/zip.ts`
- Modify: `src/shared/types.ts`
- Test: `src/main/import/download.test.ts`, `src/main/import/test-zips.ts`, `src/main/import/tree.test.ts`, `src/main/import/zip.test.ts`

**Interfaces:**
- Consumes: `IssueKind` (Task 1).
- Produces: `openExport(zips: string[], tempDir: string): Promise<ExportArchive>` with `ExportArchive { entries: Map<string, ExportEntry>; close() }`, `ExportEntry { path; size; read(): Promise<Buffer>; copyTo(dest): Promise<void> }`; `peekExport(path): Promise<ExportKind>`; `exportPages(paths): ExportPage[]`, `buildTree(pages, links): { nodes: Map<string, TreeNode>; order: Map<string | null, string[]> }`, `dirOfPath`; `downloadImage(url, fetchFn?): Promise<{ name; data }>`; in `src/main/import/types.ts`: `STAGED_FILE_PREFIX`, `StagedPage`, `StagedFile`, `StagedIssue`, `ImportManifest`, `WorkerMessage`, `WorkerInput`, `class ImportError`; in `src/shared/types.ts`: `ImportProgress`, `ImportStatus`, `ImportResult`; test helpers `FIXTURE_ZIP`, `writeZip`, `notionPage`, `subPageLink`.

- [ ] **Step 1: Add the zip libraries**

Run: `pnpm add yauzl@^3.4.0 && pnpm add -D @types/yauzl@^3.4.0 yazl@^3.3.1 @types/yazl@^3.3.1`
Expected: `"yauzl": "^3.4.0"` under `dependencies`; the other three under `devDependencies`.

- [ ] **Step 2: Write the failing tests**

Create `src/main/import/download.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { downloadImage } from './download'

function serve(body: BodyInit, headers: Record<string, string>, status = 200): typeof fetch {
  return (async () => new Response(body, { status, headers })) as unknown as typeof fetch
}

describe('downloadImage', () => {
  it('names the image after the address, adding an extension from its type', async () => {
    const png = serve(new Uint8Array([1, 2]), { 'content-type': 'image/png' })
    expect(await downloadImage('https://x.com/a/My%20Photo.jpg?w=1', png)).toEqual({
      name: 'My Photo.jpg',
      data: new Uint8Array([1, 2])
    })
    expect((await downloadImage('https://x.com/a/photo', png)).name).toBe('photo.png')
    const svg = serve('<svg/>', { 'content-type': 'image/svg+xml' })
    expect((await downloadImage('https://x.com/', svg)).name).toBe('image.svg')
  })

  it('refuses what is not an image, a failed response, or something too large', async () => {
    await expect(
      downloadImage('https://x.com/a', serve('<html>', { 'content-type': 'text/html' }))
    ).rejects.toThrow('Not an image')
    await expect(
      downloadImage('https://x.com/a', serve('', { 'content-type': 'image/png' }, 404))
    ).rejects.toThrow('HTTP 404')
    await expect(
      downloadImage(
        'https://x.com/a',
        serve('', { 'content-type': 'image/png', 'content-length': String(200 * 1024 * 1024) })
      )
    ).rejects.toThrow('Too large')
    await expect(downloadImage('file:///etc/passwd')).rejects.toThrow('Not a web address')
  })
})
```

Create `src/main/import/test-zips.ts`:

```ts
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'

export const FIXTURE_ZIP = join(__dirname, '../../../tests/fixtures/notion-export.zip')

/** Writes a zip holding `files` (path -> contents); for tests. */
export async function writeZip(
  path: string,
  files: Record<string, string | Buffer>
): Promise<string> {
  const zip = new yazl.ZipFile()
  for (const [name, data] of Object.entries(files)) {
    zip.addBuffer(typeof data === 'string' ? Buffer.from(data) : data, name)
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path))
  return path
}

/** A minimal Notion export page. */
export function notionPage(title: string, body = '', header = ''): string {
  return (
    `<html><body><article class="page sans"><header>${header}<h1 class="page-title">${title}</h1></header>` +
    `<div class="page-body">${body}</div></article></body></html>`
  )
}

export function subPageLink(href: string, id: string, title: string): string {
  return `<figure class="link-to-page"><a href="${encodeURI(href)}" data-notion-page-id="${id}">${title}</a></figure>`
}
```

Create `src/main/import/tree.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTree, exportPages } from './tree'

const id = (n: number): string => n.toString(16).padStart(32, '0')

describe('exportPages', () => {
  it('reads the Notion id and the folder sub-pages live in', () => {
    expect(
      exportPages([`S/Plans ${id(1)}.html`, 'S/Plans/image.png', `Top ${id(2)}.html`])
    ).toEqual([
      { notionId: id(1), path: `S/Plans ${id(1)}.html`, folder: 'S/Plans' },
      { notionId: id(2), path: `Top ${id(2)}.html`, folder: 'Top' }
    ])
  })
})

describe('buildTree', () => {
  it('tells apart same-titled siblings that share a folder by their links', () => {
    const pages = exportPages([
      `S/Root ${id(1)}.html`,
      `S/Root/Same ${id(2)}.html`,
      `S/Root/Same ${id(3)}.html`,
      `S/Root/Same/Child A ${id(4)}.html`,
      `S/Root/Same/Child B ${id(5)}.html`
    ])
    const links = new Map([
      [id(1), [id(3), id(2)]],
      [id(2), [id(5)]],
      [id(3), [id(4)]]
    ])
    const { nodes, order } = buildTree(pages, links)
    expect(nodes.get(id(4))!.parent).toBe(id(3))
    expect(nodes.get(id(5))!.parent).toBe(id(2))
    expect(order.get(id(1))).toEqual([id(3), id(2)])
    expect(nodes.get(id(1))).toEqual({ notionId: id(1), parent: null, group: 'S' })
  })

  it('ignores links to pages outside the linking page’s folder', () => {
    const pages = exportPages([`S/A ${id(1)}.html`, `S/B ${id(2)}.html`])
    const { nodes } = buildTree(pages, new Map([[id(1), [id(2)]]]))
    expect(nodes.get(id(2))!.parent).toBeNull()
  })

  it('puts a page nothing links to under its folder’s page', () => {
    const pages = exportPages([`S/A ${id(1)}.html`, `S/A/Lost ${id(2)}.html`])
    const { nodes, order } = buildTree(pages, new Map())
    expect(nodes.get(id(2))!.parent).toBe(id(1))
    expect(order.get(id(1))).toEqual([id(2)])
  })
})
```

Create `src/main/import/zip.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ImportError } from './types'
import { openExport, peekExport } from './zip'
import { writeZip } from './test-zips'

const PAGE = 'Notes 0123456789abcdef0123456789abcdef'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nb-zip-'))
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
    expect([...archive.entries.keys()].sort()).toEqual([
      'Other/Page.html',
      `Space/${PAGE}.html`,
      'Space/Notes/image.png'
    ])
    expect((await archive.entries.get(`Space/${PAGE}.html`)!.read()).toString()).toBe('<p>1</p>')
    await archive.entries.get('Space/Notes/image.png')!.copyTo(join(dir, 'copy.png'))
    expect(await readFile(join(dir, 'copy.png'), 'utf8')).toBe('png')
    archive.close()
  })

  it('refuses a file that is not a zip', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'fake.zip'), 'not a zip')
    await expect(openExport([join(dir, 'fake.zip')], dir)).rejects.toThrow(ImportError)
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm exec vitest run src/main/import`
Expected: FAIL with "Cannot find module './download'", "Cannot find module './tree'" and "Cannot find module './types'".

- [ ] **Step 4: Write the implementation**

Create `src/main/import/download.ts`:

```ts
import { extname } from 'node:path'

const TIMEOUT_MS = 20_000
const MAX_BYTES = 25 * 1024 * 1024

/** An image from the web, with a file name for it; throws when it is not a reasonable image. */
export async function downloadImage(
  url: string,
  fetchFn: typeof fetch = fetch
): Promise<{ name: string; data: Uint8Array }> {
  if (!/^https?:/i.test(url)) throw new Error('Not a web address')
  const response = await fetchFn(testOrigin(url), { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const type = response.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error(`Not an image: ${type}`)
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('Too large')
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength > MAX_BYTES) throw new Error('Too large')
  let name = new URL(url).pathname.split('/').pop() ?? ''
  try {
    name = decodeURIComponent(name)
  } catch {
    // Keep it encoded.
  }
  if (!extname(name)) name = `${name || 'image'}.${type.slice(6).split(/[+;]/)[0]}`
  return { name, data }
}

/** End-to-end tests serve "web" images from a local server instead of the internet. */
function testOrigin(url: string): string {
  const origin = process.env.NOBSIDIAN_E2E === '1' ? process.env.NOBSIDIAN_E2E_WEB : undefined
  if (!origin) return url
  const u = new URL(url)
  return origin + u.pathname + u.search
}
```

Create `src/main/import/tree.ts`:

```ts
// Notion's export names pages `Title <32 hex>.html` and their child folders `Title/`, without
// the id, so siblings with the same title share a folder. Parents are found through the links
// each page has to its sub-pages, and folders only decide where those links are allowed to point.

const PAGE_FILE = /^(.*) ([0-9a-f]{32})\.html$/

export interface ExportPage {
  notionId: string
  path: string
  /** The folder its sub-pages live in. */
  folder: string
}

export function exportPages(paths: Iterable<string>): ExportPage[] {
  const pages: ExportPage[] = []
  for (const path of paths) {
    const slash = path.lastIndexOf('/')
    const dir = slash === -1 ? '' : path.slice(0, slash)
    const m = PAGE_FILE.exec(path.slice(slash + 1))
    if (!m) continue
    pages.push({ notionId: m[2], path, folder: dir ? `${dir}/${m[1]}` : m[1] })
  }
  return pages
}

export function dirOfPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export interface TreeNode {
  notionId: string
  /** Null for a top-level page of the export. */
  parent: string | null
  /** The export folder a top-level page sits in, such as `Private & Shared`. */
  group: string
}

/**
 * Each page's parent and its children's order, from the sub-page links (`links`, in order of
 * appearance) every page contains.
 */
export function buildTree(
  pages: ExportPage[],
  links: Map<string, string[]>
): { nodes: Map<string, TreeNode>; order: Map<string | null, string[]> } {
  const byFolder = new Map<string, ExportPage[]>()
  for (const p of pages) {
    const list = byFolder.get(p.folder)
    if (list) list.push(p)
    else byFolder.set(p.folder, [p])
  }
  const byId = new Map(pages.map((p) => [p.notionId, p]))
  const nodes = new Map<string, TreeNode>()
  const order = new Map<string | null, string[]>()
  const push = (parent: string | null, id: string): void => {
    const list = order.get(parent)
    if (list) list.push(id)
    else order.set(parent, [id])
  }
  // Linked sub-pages first, in the order their parent shows them.
  for (const p of pages) {
    for (const childId of links.get(p.notionId) ?? []) {
      const child = byId.get(childId)
      if (!child || nodes.has(childId) || childId === p.notionId) continue
      if (dirOfPath(child.path) !== p.folder) continue
      nodes.set(childId, { notionId: childId, parent: p.notionId, group: '' })
      push(p.notionId, childId)
    }
  }
  // Pages nothing links to: their folder's page, else the top level.
  const rest = pages
    .filter((p) => !nodes.has(p.notionId))
    .sort((a, b) => a.path.localeCompare(b.path))
  for (const p of rest) {
    const dir = dirOfPath(p.path)
    const owner = pages.find((o) => o.folder === dir && o.notionId !== p.notionId)
    if (owner) {
      nodes.set(p.notionId, { notionId: p.notionId, parent: owner.notionId, group: '' })
      push(owner.notionId, p.notionId)
    } else {
      nodes.set(p.notionId, { notionId: p.notionId, parent: null, group: dir })
      push(null, p.notionId)
    }
  }
  return { nodes, order }
}
```

Create `src/main/import/types.ts`:

```ts
import type { Block } from '../../shared/core/blocks'
import type { IssueKind } from '../../shared/notion/types'
import type { ImportProgress } from '../../shared/types'

/** Hrefs to imported files use this scheme until landing gives each file its final name. */
export const STAGED_FILE_PREFIX = 'nobsidian-import:file/'

export interface StagedPage {
  /** The page's new Nobsidian id. */
  id: string
  notionId?: string
  parentId: string | null
  title: string
  /** An emoji, or a staged file href. */
  icon?: string
  cover?: string
  /** Links use internal hrefs: `nobsidian://page/<id>` and staged file hrefs. */
  blocks: Block[]
}

export interface StagedFile {
  key: string
  /** The name the file had in Notion. */
  name: string
  /** Absolute path of the copy in the staging folder; missing when a download failed. */
  path?: string
  /** The address a failed download is linked to instead. */
  url?: string
}

export interface StagedIssue {
  kind: IssueKind
  detail: string
  pageId: string
}

export interface ImportManifest {
  pages: StagedPage[]
  files: StagedFile[]
  issues: StagedIssue[]
  sources: string[]
  startedAt: number
}

export type WorkerMessage =
  | { type: 'progress'; progress: ImportProgress }
  | { type: 'done'; manifest: ImportManifest }
  | { type: 'error'; message: string }

export interface WorkerInput {
  zips: string[]
  staging: string
}

/** A failure whose message is meant for the user, as opposed to a bug. */
export class ImportError extends Error {}
```

Create `src/main/import/zip.ts`:

```ts
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { ImportError } from './types'

/** A file inside the export, by its path in the zip, wherever it was nested. */
export interface ExportEntry {
  path: string
  size: number
  read(): Promise<Buffer>
  copyTo(dest: string): Promise<void>
}

export interface ExportArchive {
  entries: Map<string, ExportEntry>
  close(): void
}

/**
 * Opens one or more zips as one export: zips inside them (Notion's `Part-N.zip`) are copied to
 * `tempDir` and opened in turn, and every part's files share one tree of paths.
 */
export async function openExport(zips: string[], tempDir: string): Promise<ExportArchive> {
  const entries = new Map<string, ExportEntry>()
  const open: ZipFile[] = []
  let nested = 0
  const add = async (path: string): Promise<void> => {
    let zip: ZipFile
    try {
      zip = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false })
    } catch {
      throw new ImportError("This file isn't a zip, or it's damaged.")
    }
    open.push(zip)
    for (const entry of await listEntries(zip)) {
      const name = entry.fileName
      if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(name)) {
        continue
      }
      if (/\.zip$/i.test(name)) {
        const copy = join(tempDir, `nested-${++nested}.zip`)
        await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(copy))
        await add(copy)
        continue
      }
      entries.set(name, {
        path: name,
        size: entry.uncompressedSize,
        read: async () => readAll(await zip.openReadStreamPromise(entry)),
        copyTo: async (dest) =>
          pipeline(await zip.openReadStreamPromise(entry), createWriteStream(dest))
      })
    }
  }
  try {
    for (const zip of zips) await add(zip)
  } catch (err) {
    for (const zip of open) zip.close()
    throw err
  }
  return { entries, close: () => open.forEach((zip) => zip.close()) }
}

function listEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const out: Entry[] = []
    zip.on('entry', (entry: Entry) => {
      out.push(entry)
      zip.readEntry()
    })
    zip.once('end', () => resolve(out))
    zip.on('error', () => reject(new ImportError('This zip is damaged.')))
    zip.readEntry()
  })
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

export type ExportKind = 'notion-html' | 'notion-markdown' | 'other'

const NOTION_PAGE = /(^|\/)[^/]* [0-9a-f]{32}\.(html|md)$/
const NOTION_PART = /(^|\/)[^/]*Export[^/]*\.zip$/i

/** What a zip looks like from its file names alone, without extracting anything. */
export async function peekExport(path: string): Promise<ExportKind> {
  let zip: ZipFile
  try {
    zip = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false })
  } catch {
    return 'other'
  }
  try {
    const names = (await listEntries(zip)).map((e) => e.fileName)
    if (names.some((n) => NOTION_PAGE.test(n) && n.endsWith('.html'))) return 'notion-html'
    if (names.some((n) => NOTION_PAGE.test(n))) return 'notion-markdown'
    // Large exports are a zip of part zips; their contents are checked when importing.
    if (names.some((n) => NOTION_PART.test(n))) return 'notion-html'
    return 'other'
  } catch {
    return 'other'
  } finally {
    zip.close()
  }
}
```

Apply this change to `src/shared/types.ts`:

```diff
@@ -75,3 +75,22 @@ export interface HistoryVersion {
   /** ISO time the snapshot was taken. */
   at: string
 }
+
+export interface ImportProgress {
+  phase: 'reading' | 'converting' | 'copying' | 'finishing'
+  done: number
+  total: number
+}
+
+export type ImportStatus =
+  | { state: 'running'; progress: ImportProgress }
+  | { state: 'done'; rootId: string; reportId: string; pages: number; issues: number }
+  | { state: 'cancelled' }
+  | { state: 'failed'; message: string }
+
+export interface ImportResult {
+  rootId: string
+  reportId: string
+  pages: number
+  issues: number
+}
```

- [ ] **Step 5: Run the tests and checks**

Run: `pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: 206 unit tests pass; no type errors; ESLint reports nothing.

- [ ] **Step 6: Commit (ask Dale first)**

```bash
git add package.json pnpm-lock.yaml src/main/import/download.test.ts src/main/import/download.ts src/main/import/test-zips.ts src/main/import/tree.test.ts src/main/import/tree.ts src/main/import/types.ts src/main/import/zip.test.ts src/main/import/zip.ts src/shared/types.ts
git commit -m "Read Notion exports: zips, page tree and image downloads"
```


---

### Task 3: The import pipeline

`runImport` turns an export into a manifest without touching the workspace: it gives every page a new id, maps it with a context that resolves page links (by Notion id, export path or Notion URL) and files, puts a database row's properties in a table at the top, builds the tree (with a page per top-level folder when an export has several), and copies or downloads every referenced file into staging.
The fixture's ten pages are pinned against Markdown that was reviewed by hand; page ids in links are replaced by Notion ids so the files stay stable.

**Files:**
- Create: `src/main/import/pipeline.ts`
- Test: `src/main/import/pipeline.test.ts`, `tests/fixtures/notion-export.expected/01 Nobsidian import fixture.md`, `tests/fixtures/notion-export.expected/02 Child page.md`, `tests/fixtures/notion-export.expected/03 Grandchild page.md`, `tests/fixtures/notion-export.expected/04 Q&A- plans - ideas-.md`, `tests/fixtures/notion-export.expected/05 Same name.md`, `tests/fixtures/notion-export.expected/06 Same name.md`, `tests/fixtures/notion-export.expected/07 Reading list.md`, `tests/fixtures/notion-export.expected/08 The Left Hand of Darkness.md`, `tests/fixtures/notion-export.expected/09 Untitled draft.md`, `tests/fixtures/notion-export.expected/10 A Brief History of Time.md`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `runImport(options: { zips: string[]; staging: string; onProgress?(p: ImportProgress): void; fetch?: typeof fetch }): Promise<ImportManifest>`, throwing `ImportError` with "This is a Markdown export. Export again as HTML." or "This zip isn't a Notion HTML export.".

- [ ] **Step 1: Write the failing tests**

Create `src/main/import/pipeline.test.ts`:

```ts
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
```

Create `tests/fixtures/notion-export.expected/01 Nobsidian import fixture.md` (the reviewed output it must match):

````markdown
This page is a test fixture for Nobsidian's Notion importer. It covers every block type, color and special case.

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

## Inline styles

Plain, **bold**, *italic*, <u>underline</u>, ~~strike~~, `inline code`, [a link](https://example.com), **_bold italic_**, **bold with** `code` and inline math $E = mc^2$ in one paragraph.

First line of a paragraph\
second line after a hard line break.

&nbsp;

The empty paragraph above is intentional.

## Text colors

<span data-color="gray">gray</span> <span data-color="brown">brown</span> <span data-color="orange">orange</span> <span data-color="yellow">yellow</span> <span data-color="green">green</span> <span data-color="blue">blue</span> <span data-color="purple">purple</span> <span data-color="pink">pink</span> <span data-color="red">red</span>

## Highlights

<span data-bg="gray">gray</span> <span data-bg="brown">brown</span> <span data-bg="orange">orange</span> <span data-bg="yellow">yellow</span> <span data-bg="green">green</span> <span data-bg="blue">blue</span> <span data-bg="purple">purple</span> <span data-bg="pink">pink</span> <span data-bg="red">red</span>

Mixed: **<span data-color="red">bold red</span>** and <u><span data-bg="yellow">underlined on yellow</span></u>.

## Block colors

A paragraph with blue text.<!-- color=blue -->

A paragraph with a yellow background.<!-- bg=yellow -->

### A heading with a purple background<!-- bg=purple -->

- A red list item<!-- color=red -->

## Lists

- Bullet one
- Bullet two
  - Nested bullet
    - Third level bullet
- Bullet three

1. Number one
2. Number two
   1. Nested number
      1. Third level number
3. Number three

- [ ] Unchecked to-do
- [x] Checked to-do
  - [ ] Nested to-do
    - [x] Third level to-do

## Toggles

<details>
<summary>A toggle</summary>

Hidden paragraph inside the toggle.

- A bullet inside the toggle

</details>

<details data-heading="1">
<summary>Toggle heading 1</summary>

Content under toggle heading 1.

</details>

<details data-heading="2">
<summary>Toggle heading 2</summary>

Content under toggle heading 2.

</details>

<details data-heading="3">
<summary>Toggle heading 3</summary>

Content under toggle heading 3.

</details>

## Quote and callouts

> A plain quote.

> A quote with a green background<!-- bg=green -->
>
> A child paragraph inside the quote.

> [!callout] 💡
> A default callout
>
> - A bullet inside the callout

> [!callout:orange_bg] 🚧
> An orange callout with a custom icon

---

## Code

```tsx
export function greet(name: string): string {
  return `Hello, ${name}`
}
```

```python
def greet(name):
    return f"Hello, {name}"
```

## Equation

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

## Tables

| Name  | Role     | Score |
| ----- | -------- | ----- |
| Ada   | Engineer | 10    |
| Grace | Admiral  | 9     |

| Fruit  | Color  | Price           |
| ------ | ------ | --------------- |
| Apple  | Red    | 1.20            |
| Banana | Yellow | 0.50<br>on sale |

## Table of contents

<nav data-toc></nav>

## Media

![An uploaded image with a caption](nobsidian-import:file/2)

![An external image](nobsidian-import:file/3)

[fixture-report.pdf](nobsidian-import:file/4 "file")

## Columns

<div data-columns>

<div data-column>

Left column, half width.

- A list in the left column

</div>

<div data-column>

Right column, half width.

</div>

</div>

<div data-columns>

<div data-column data-width="0.6">

Narrow column.

</div>

<div data-column data-width="1.5">

<details>
<summary>Toggle inside a column</summary>

- List inside a toggle inside a column
  - Nested deeper

</details>

</div>

<div data-column data-width="0.9">

Third column.

</div>

</div>

## Bookmark and embed

<https://www.wikipedia.org>

<https://www.youtube.com/watch?v=aqz-KE-bpKQ>

## Synced block

This text lives in a synced block.

## Links and mentions

A page mention: [Grandchild page](notion://4007c9e82e0e81e79ed6d9a0bd0123a7).

A plain link to a sub-page: [go to the child page](notion://4007c9e82e0e81f7b102df32904f66ba).

A mention of a database row: [The Left Hand of Darkness](notion://4007c9e82e0e814c960cdf7fcf4b6a9e).

A date mention: @October 22, 2026 and a date range: @November 1, 2026 → November 3, 2026.

A person mention: @Ada Lovelace.

## Sub-pages and database

[4007c9e82e0e81f7b102df32904f66ba](notion://4007c9e82e0e81f7b102df32904f66ba "page")

[4007c9e82e0e8127999ee63ec39055a2](notion://4007c9e82e0e8127999ee63ec39055a2 "page")

[4007c9e82e0e81c983d1d6f04440ece4](notion://4007c9e82e0e81c983d1d6f04440ece4 "page")

[4007c9e82e0e819d9747ccfbcf815c24](notion://4007c9e82e0e819d9747ccfbcf815c24 "page")

[9a60be708a6d4a328b6fffd32be620c2](notion://9a60be708a6d4a328b6fffd32be620c2 "page")
````

Create `tests/fixtures/notion-export.expected/02 Child page.md` (the reviewed output it must match):

```markdown
A child page with its own icon. Its grandchild is below.

The synced block from the fixture page, shown here as a reference:

This text lives in a synced block.

[4007c9e82e0e81e79ed6d9a0bd0123a7](notion://4007c9e82e0e81e79ed6d9a0bd0123a7 "page")
```

Create `tests/fixtures/notion-export.expected/03 Grandchild page.md` (the reviewed output it must match):

```markdown
A grandchild page. It links back up to [Nobsidian import fixture](notion://4007c9e82e0e81549d17cfdfeaddaf81) and across to [Q\&A: plans / ideas?](notion://4007c9e82e0e8127999ee63ec39055a2).

And a plain link to the root: [Nobsidian import fixture](notion://4007c9e82e0e81549d17cfdfeaddaf81).
```

Create `tests/fixtures/notion-export.expected/04 Q&A- plans - ideas-.md` (the reviewed output it must match):

```markdown
A page whose title has characters macOS file names can't hold.
```

Create `tests/fixtures/notion-export.expected/05 Same name.md` (the reviewed output it must match):

```markdown
The first of two sibling pages with the same title.
```

Create `tests/fixtures/notion-export.expected/06 Same name.md` (the reviewed output it must match):

```markdown
The second of two sibling pages with the same title.
```

Create `tests/fixtures/notion-export.expected/07 Reading list.md` (the reviewed output it must match):

```markdown
| Name                                                                   | Finished       | Link                            | Owned | Rating | Status                              | Tags                                                                       |
| ---------------------------------------------------------------------- | -------------- | ------------------------------- | ----- | ------ | ----------------------------------- | -------------------------------------------------------------------------- |
| [The Left Hand of Darkness](notion://4007c9e82e0e814c960cdf7fcf4b6a9e) | March 14, 2026 | <https://example.com/left-hand> | ☑     | 5      | <span data-bg="green">Done</span>   | <span data-bg="pink">fiction</span>                                        |
| [Untitled draft](notion://4007c9e82e0e817d9417ea8acece88a5)            |                |                                 | ☐     |        | <span data-bg="gray">To read</span> |                                                                            |
| [A Brief History of Time](notion://4007c9e82e0e81daba55cfe1ebde464d)   |                |                                 | ☐     | 4      | <span data-bg="blue">Reading</span> | <span data-bg="brown">history</span> <span data-bg="purple">science</span> |
```

Create `tests/fixtures/notion-export.expected/08 The Left Hand of Darkness.md` (the reviewed output it must match):

```markdown
| Finished | March 14, 2026                      |
| -------- | ----------------------------------- |
| Link     | <https://example.com/left-hand>     |
| Owned    | ☑                                   |
| Rating   | 5                                   |
| Status   | <span data-bg="green">Done</span>   |
| Tags     | <span data-bg="pink">fiction</span> |

Notes on this book: a row page with **body content**.

- First thought
- Second thought
```

Create `tests/fixtures/notion-export.expected/09 Untitled draft.md` (the reviewed output it must match):

```markdown
| Owned  | ☐                                   |
| ------ | ----------------------------------- |
| Status | <span data-bg="gray">To read</span> |
| Tags   |                                     |
```

Create `tests/fixtures/notion-export.expected/10 A Brief History of Time.md` (the reviewed output it must match):

```markdown
| Owned  | ☐                                                                          |
| ------ | -------------------------------------------------------------------------- |
| Rating | 4                                                                          |
| Status | <span data-bg="blue">Reading</span>                                        |
| Tags   | <span data-bg="brown">history</span> <span data-bg="purple">science</span> |
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/main/import/pipeline.test.ts`
Expected: FAIL with "Cannot find module './pipeline'".

- [ ] **Step 3: Write the implementation**

Create `src/main/import/pipeline.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { Root } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import type { Block, Inline } from '../../shared/core/blocks'
import { pageLinkHref } from '../../shared/core/links'
import { isExternalHref, resolveHref } from '../../shared/core/paths'
import { attr, findAll, hasClass } from '../../shared/notion/hast'
import { mapNotionPage } from '../../shared/notion/html'
import type { IssueKind, MapContext } from '../../shared/notion/types'
import type { ImportProgress } from '../../shared/types'
import { downloadImage } from './download'
import { buildTree, exportPages, type ExportPage } from './tree'
import {
  ImportError,
  STAGED_FILE_PREFIX,
  type ImportManifest,
  type StagedFile,
  type StagedIssue,
  type StagedPage
} from './types'
import { openExport, type ExportArchive } from './zip'

export interface ImportOptions {
  zips: string[]
  staging: string
  onProgress?(progress: ImportProgress): void
  /** Downloads an external image; tests replace the network. */
  fetch?: typeof fetch
}

const NOTION_URL = /^https?:\/\/([\w-]+\.)*(notion\.so|notion\.site|notion\.com)\//i

/** Reads a Notion HTML export and stages its pages and files; nothing in the workspace changes. */
export async function runImport(options: ImportOptions): Promise<ImportManifest> {
  const startedAt = Date.now()
  const progress = (p: ImportProgress): void => options.onProgress?.(p)
  progress({ phase: 'reading', done: 0, total: 0 })
  await mkdir(join(options.staging, 'files'), { recursive: true })
  const archive = await openExport(options.zips, options.staging)
  try {
    const paths = [...archive.entries.keys()]
    const pages = exportPages(paths)
    if (pages.length === 0) {
      if (paths.some((p) => / [0-9a-f]{32}\.md$/.test(p))) {
        throw new ImportError('This is a Markdown export. Export again as HTML.')
      }
      throw new ImportError("This zip isn't a Notion HTML export.")
    }
    return await convert(archive, pages, options, startedAt, progress)
  } finally {
    archive.close()
  }
}

async function convert(
  archive: ExportArchive,
  pages: ExportPage[],
  options: ImportOptions,
  startedAt: number,
  progress: (p: ImportProgress) => void
): Promise<ImportManifest> {
  const ids = new Map(pages.map((p) => [p.notionId, randomUUID()]))
  const byPath = new Map(pages.map((p) => [p.path, p.notionId]))
  const issues: StagedIssue[] = []
  const files = new Map<string, PendingFile>()
  const links = new Map<string, string[]>()
  const staged = new Map<string, StagedPage>()

  const fileHref = (pageId: string, source: string, name: string, url?: string): string => {
    let file = files.get(source)
    if (!file) {
      file = { key: String(files.size + 1), name, source, url, pageId }
      files.set(source, file)
    }
    return STAGED_FILE_PREFIX + file.key
  }

  for (const [i, page] of pages.entries()) {
    progress({ phase: 'converting', done: i, total: pages.length })
    const id = ids.get(page.notionId)!
    const issue = (kind: IssueKind, detail: string): void => {
      issues.push({ kind, detail, pageId: id })
    }
    const ctx: MapContext = {
      link: (href, pageId) => {
        const notionId = pageId?.replace(/-/g, '')
        if (notionId && ids.has(notionId)) return pageLinkHref(ids.get(notionId)!)
        if (NOTION_URL.test(href)) {
          const found = /([0-9a-f]{32})(?:[?#]|$)/.exec(href.replace(/-/g, ''))?.[1]
          if (found && ids.has(found)) return pageLinkHref(ids.get(found)!)
          issue('outsideLink', href)
          return href
        }
        if (isExternalHref(href)) return href
        const target = resolveHref(page.path, href)
        const linked = byPath.get(target)
        if (linked) return pageLinkHref(ids.get(linked)!)
        if (archive.entries.has(target)) return fileHref(id, target, baseName(target))
        if (notionId) issue('outsideLink', href)
        return href
      },
      file: (src) => {
        if (/^https?:/i.test(src)) return fileHref(id, src, baseName(new URL(src).pathname), src)
        if (/^data:/i.test(src)) return src
        const target = resolveHref(page.path, src)
        if (archive.entries.has(target)) return fileHref(id, target, baseName(target))
        issue('missingFile', target)
        return src
      },
      issue
    }
    try {
      const html = (await archive.entries.get(page.path)!.read()).toString('utf8')
      const root = fromHtml(html)
      links.set(page.notionId, subPageLinks(root))
      const mapped = mapNotionPage(root, ctx)
      const blocks = mapped.properties.length
        ? [propertiesTable(mapped.properties), ...mapped.blocks]
        : mapped.blocks
      staged.set(page.notionId, {
        id,
        notionId: page.notionId,
        parentId: null,
        title: mapped.title || stemOf(page.path),
        icon: mapped.icon
          ? 'emoji' in mapped.icon
            ? mapped.icon.emoji
            : mapped.icon.src
          : undefined,
        cover: mapped.cover,
        blocks
      })
    } catch {
      issue('failedPage', page.path)
      staged.set(page.notionId, {
        id,
        notionId: page.notionId,
        parentId: null,
        title: stemOf(page.path),
        blocks: []
      })
    }
  }

  const { nodes, order } = buildTree(pages, links)
  const groups = [...new Set([...nodes.values()].filter((n) => !n.parent).map((n) => n.group))]
  const groupIds = new Map<string, string>()
  const groupPages: StagedPage[] = []
  if (groups.length > 1) {
    for (const group of groups) {
      const id = randomUUID()
      groupIds.set(group, id)
      groupPages.push({ id, parentId: null, title: group.split('/').pop() || 'Notion', blocks: [] })
    }
  }
  for (const [notionId, node] of nodes) {
    const page = staged.get(notionId)!
    page.parentId = node.parent ? ids.get(node.parent)! : (groupIds.get(node.group) ?? null)
  }
  // Pages in the order Notion shows them: parents before children, siblings in link order.
  const ordered: StagedPage[] = [...groupPages]
  const visit = (parent: string | null): void => {
    for (const notionId of order.get(parent) ?? []) {
      ordered.push(staged.get(notionId)!)
      visit(notionId)
    }
  }
  visit(null)

  const stagedFiles = await stageFiles(archive, [...files.values()], options, issues, progress)
  return {
    pages: ordered,
    files: stagedFiles,
    issues,
    sources: options.zips,
    startedAt
  }
}

/** Notion ids of the sub-pages and database rows a page shows, in order. */
function subPageLinks(root: Root): string[] {
  const out: string[] = []
  const anchors = findAll(root, (el) => {
    if (el.tagName !== 'figure' && el.tagName !== 'td') return false
    return hasClass(el, 'link-to-page') || hasClass(el, 'cell-title')
  }).flatMap((box) => findAll(box, (el) => el.tagName === 'a'))
  for (const a of anchors) {
    const id = attr(a, 'data-notion-page-id')?.replace(/-/g, '')
    const fromHref = /([0-9a-f]{32})\.html$/.exec(decodeURIComponent(attr(a, 'href') ?? ''))?.[1]
    const notionId = id ?? fromHref
    if (notionId) out.push(notionId)
  }
  return out
}

function propertiesTable(properties: { name: string; value: Inline[] }[]): Block {
  return {
    type: 'table',
    props: {},
    content: {
      type: 'tableContent',
      rows: properties.map((p) => ({
        cells: [[{ type: 'text', text: p.name, styles: {} }], p.value]
      }))
    },
    children: []
  }
}

interface PendingFile {
  key: string
  name: string
  /** Its path in the export, or its URL. */
  source: string
  url?: string
  /** The first page that uses it, for the report. */
  pageId: string
}

async function stageFiles(
  archive: ExportArchive,
  files: PendingFile[],
  options: ImportOptions,
  issues: StagedIssue[],
  progress: (p: ImportProgress) => void
): Promise<StagedFile[]> {
  const out: StagedFile[] = []
  for (const [i, file] of files.entries()) {
    progress({ phase: 'copying', done: i, total: files.length })
    const dest = join(options.staging, 'files', file.key + safeExt(file.name))
    if (file.url) {
      const image = await downloadImage(file.url, options.fetch).catch(() => null)
      if (image) {
        await writeFile(dest, image.data)
        out.push({ key: file.key, name: image.name, path: dest })
      } else {
        issues.push({ kind: 'download', detail: file.url, pageId: file.pageId })
        out.push({ key: file.key, name: file.name, url: file.url })
      }
      continue
    }
    await archive.entries.get(file.source)!.copyTo(dest)
    out.push({ key: file.key, name: file.name, path: dest })
  }
  return out
}

function baseName(path: string): string {
  return decodeURIComponent(path.split('/').pop() ?? '') || 'file'
}

function stemOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/ [0-9a-f]{32}\.html$/, '')
}

function safeExt(name: string): string {
  const ext = extname(name).toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
}
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: 214 unit tests pass; no type errors; ESLint reports nothing.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add src/main/import/pipeline.test.ts src/main/import/pipeline.ts 'tests/fixtures/notion-export.expected/01 Nobsidian import fixture.md' 'tests/fixtures/notion-export.expected/02 Child page.md' 'tests/fixtures/notion-export.expected/03 Grandchild page.md' 'tests/fixtures/notion-export.expected/04 Q&A- plans - ideas-.md' 'tests/fixtures/notion-export.expected/05 Same name.md' 'tests/fixtures/notion-export.expected/06 Same name.md' 'tests/fixtures/notion-export.expected/07 Reading list.md' 'tests/fixtures/notion-export.expected/08 The Left Hand of Darkness.md' 'tests/fixtures/notion-export.expected/09 Untitled draft.md' 'tests/fixtures/notion-export.expected/10 A Brief History of Time.md'
git commit -m "Convert a Notion export into staged pages and files"
```


---

### Task 4: Landing an import in the workspace

`PageImports` owns staging folders inside `.nobsidian/` and lands a manifest as one queued workspace task: staged files move into `attachments/` (numbered on a clash), the tree is written with final relative links into staging and renamed into the workspace under "Imported from Notion" (or "(2)"), then the pages, order and search index are registered and one tree event fires.
The report page is written last inside the new page.
Leftover staging from a crash is removed by `maintain()`, and `findNotionPages` finds imported pages by the `notionId` in their frontmatter, for paste.

**Files:**
- Create: `src/main/workspace/page-import.ts`
- Modify: `src/main/workspace/workspace.ts`
- Test: `src/main/workspace/import.test.ts`

**Interfaces:**
- Consumes: `ImportManifest`, `STAGED_FILE_PREFIX` (Task 2); `runImport` (Task 3, in tests); `WorkspaceCore` helpers `pageStem`, `toFileHref`, `metaHrefToFile`, `writeText`, `remember`, `insertOrder`, `persist`, `emit`.
- Produces: `Workspace.createImportStaging(): Promise<string>`, `discardImport(staging): Promise<void>`, `landImport(manifest, staging): Promise<ImportResult>`, `findNotionPages(notionIds: string[]): Record<string, string>`; `IMPORT_TITLE = 'Imported from Notion'`, `REPORT_TITLE = 'Import report'`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/workspace/import.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceEvent } from './core'
import { runImport } from '../import/pipeline'
import { FIXTURE_ZIP } from '../import/test-zips'
import type { ImportManifest } from '../import/types'
import { Workspace } from './workspace'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nobsidian-import-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const read = (rel: string): Promise<string> => readFile(join(root, rel), 'utf8')
const png = (async () =>
  new Response(new Uint8Array([137, 80, 78, 71]), {
    headers: { 'content-type': 'image/png' }
  })) as unknown as typeof fetch

async function importFixture(ws: Workspace): Promise<ImportManifest & { staging: string }> {
  const staging = await ws.createImportStaging()
  const manifest = await runImport({ zips: [FIXTURE_ZIP], staging, fetch: png })
  return { ...manifest, staging }
}

describe('landing an import', () => {
  it('adds the pages under a new top-level page with working links', async () => {
    const ws = await Workspace.open(root)
    const events: WorkspaceEvent[] = []
    ws.onEvent((e) => events.push(e))
    const manifest = await importFixture(ws)
    const result = await ws.landImport(manifest, manifest.staging)

    expect(result).toMatchObject({ pages: 10, issues: 2 })
    expect(events).toContainEqual({ type: 'tree' })
    const [top] = ws.tree()
    expect(top.title).toBe('Imported from Notion')
    expect(top.children.map((c) => c.title)).toEqual(['Nobsidian import fixture', 'Import report'])
    expect(top.children[0].children.map((c) => c.title)).toEqual([
      'Child page',
      'Q&A: plans / ideas?',
      'Same name',
      'Same name',
      'Reading list'
    ])

    const fixture = await read('Imported from Notion/Nobsidian import fixture.md')
    expect(fixture).toMatch(
      /^---\nid: [\w-]+\nicon: 🧪\ncover: \.\.\/attachments\/gradients_8\.png\n/
    )
    expect(fixture).toContain('notionId: 4007c9e82e0e81549d17cfdfeaddaf81')
    expect(fixture).toContain(
      '![An uploaded image with a caption](../attachments/fixture-image.png)'
    )
    expect(fixture).toContain(
      '[Grandchild page](Nobsidian%20import%20fixture/Child%20page/Grandchild%20page.md)'
    )
    expect(fixture).toContain(
      '[Same name (2)](Nobsidian%20import%20fixture/Same%20name%20\\(2\\).md "page")'
    )
    expect(
      await read('Imported from Notion/Nobsidian import fixture/Q&A- plans - ideas-.md')
    ).toContain('title: "Q&A: plans / ideas?"')
    expect((await readdir(join(root, 'attachments'))).sort()).toEqual([
      'fixture-image.png',
      'fixture-report.pdf',
      'gradients_2.png',
      'gradients_8.png'
    ])
    expect(await readdir(join(root, '.nobsidian'))).not.toContainEqual(
      expect.stringMatching(/^import-/)
    )
    ws.close()
  })

  it('writes a report listing what was not converted exactly', async () => {
    const ws = await Workspace.open(root, { now: () => new Date('2026-10-22T10:00:00Z') })
    const manifest = await importFixture(ws)
    await ws.landImport(
      { ...manifest, startedAt: Date.parse('2026-10-22T09:59:57Z') },
      manifest.staging
    )
    expect(await read('Imported from Notion/Import report.md')).toMatch(
      new RegExp(
        'Imported 10 pages and 4 files from notion-export\\.zip on October 22, 2026 at 10:00 AM, in 3 seconds\\.\n\n' +
          '## Table formatting not kept \\(2\\)\n\n' +
          '- \\[Nobsidian import fixture\\]\\(Nobsidian%20import%20fixture\\.md\\): Header column \\(kept as a normal column\\)\n' +
          '- \\[Nobsidian import fixture\\]\\(Nobsidian%20import%20fixture\\.md\\): Table cell colors\n'
      )
    )
    ws.close()
  })

  it('lands a second import beside the first, with its own attachment names', async () => {
    const ws = await Workspace.open(root)
    for (let i = 0; i < 2; i++) {
      const manifest = await importFixture(ws)
      await ws.landImport(manifest, manifest.staging)
    }
    expect(ws.tree().map((n) => n.path)).toEqual([
      'Imported from Notion.md',
      'Imported from Notion (2).md'
    ])
    expect(await read('Imported from Notion (2)/Nobsidian import fixture.md')).toContain(
      '(../attachments/fixture-image%20\\(2\\).png)'
    )
    ws.close()
  })

  it('keeps the imported pages, their order and identity after reopening', async () => {
    const ws = await Workspace.open(root)
    const manifest = await importFixture(ws)
    await ws.landImport(manifest, manifest.staging)
    const before = JSON.stringify(ws.tree())
    ws.close()
    const again = await Workspace.open(root)
    expect(JSON.stringify(again.tree())).toBe(before)
    again.close()
  })

  it('does not treat its own files as edits made outside the app', async () => {
    const ws = await Workspace.open(root)
    const manifest = await importFixture(ws)
    await ws.landImport(manifest, manifest.staging)
    const events: WorkspaceEvent[] = []
    ws.onEvent((e) => events.push(e))
    await ws.reconcile([
      { kind: 'addDir', path: 'Imported from Notion' },
      { kind: 'add', path: 'Imported from Notion.md' },
      { kind: 'add', path: 'Imported from Notion/Nobsidian import fixture.md' }
    ])
    expect(events.filter((e) => e.type === 'page')).toEqual([])
    expect(ws.tree()).toHaveLength(1)
    ws.close()
  })

  it('finds imported pages by their Notion id, quoted or not', async () => {
    const ws = await Workspace.open(root)
    const manifest = await importFixture(ws)
    await ws.landImport(manifest, manifest.staging)
    const fixture = manifest.pages[0]
    expect(ws.findNotionPages(['4007c9e82e0e81549d17cfdfeaddaf81', 'ffff'])).toEqual({
      '4007c9e82e0e81549d17cfdfeaddaf81': fixture.id
    })
    await writeFile(
      join(root, 'Digits.md'),
      "---\nid: digits\nnotionId: '12345678901234567890123456789012'\n---\n"
    )
    const reopened = (ws.close(), await Workspace.open(root))
    expect(reopened.findNotionPages(['12345678901234567890123456789012'])).toEqual({
      '12345678901234567890123456789012': 'digits'
    })
    reopened.close()
  })
})

describe('import staging', () => {
  it('is removed when discarded, and leftovers are removed on maintenance', async () => {
    const ws = await Workspace.open(root)
    const kept = await ws.createImportStaging()
    const dropped = await ws.createImportStaging()
    await ws.discardImport(dropped)
    await mkdir(join(root, '.nobsidian', 'import-1-crashed'))
    await ws.maintain()
    const left = (await readdir(join(root, '.nobsidian'))).filter((n) => n.startsWith('import-'))
    expect(left.map((n) => join(root, '.nobsidian', n))).toEqual([kept])
    ws.close()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/main/workspace/import.test.ts`
Expected: FAIL with "ws.createImportStaging is not a function".

- [ ] **Step 3: Write the implementation**

Create `src/main/workspace/page-import.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type { Block, Inline } from '../../shared/core/blocks'
import { mapBlockLinks, pageLinkHref } from '../../shared/core/links'
import { serializePage, type PageMeta } from '../../shared/core/page'
import { childDirOf, encodeHref, joinPath, sanitizeTitle, stemOf } from '../../shared/core/paths'
import { blocksText } from '../../shared/core/text'
import { ISSUE_KINDS, type IssueKind } from '../../shared/notion/types'
import type { ImportResult } from '../../shared/types'
import { STAGED_FILE_PREFIX, type ImportManifest, type StagedPage } from '../import/types'
import { ATTACHMENTS_DIR, type PageRecord, type WorkspaceCore } from './core'
import { uniqueName, writeFileAtomic } from './fs-utils'
import { APP_DIR } from './state'

export const IMPORT_TITLE = 'Imported from Notion'
export const REPORT_TITLE = 'Import report'
const STAGING_PREFIX = 'import-'

/** Staging folders for imports, inside the workspace so landing is a rename. */
export class PageImports {
  private readonly active = new Set<string>()

  constructor(private readonly core: WorkspaceCore) {}

  async createStaging(): Promise<string> {
    const dir = join(
      this.core.root,
      APP_DIR,
      `${STAGING_PREFIX}${Date.now()}-${randomUUID().slice(0, 8)}`
    )
    await mkdir(dir, { recursive: true })
    this.active.add(dir)
    return dir
  }

  async discard(staging: string): Promise<void> {
    this.active.delete(staging)
    await rm(staging, { recursive: true, force: true })
  }

  /** Removes staging left by an import that was interrupted by a crash or quit. */
  async removeStale(): Promise<void> {
    const dir = join(this.core.root, APP_DIR)
    const names = await readdir(dir).catch(() => [] as string[])
    for (const name of names) {
      const path = join(dir, name)
      if (name.startsWith(STAGING_PREFIX) && !this.active.has(path)) {
        await rm(path, { recursive: true, force: true })
      }
    }
  }

  /** Moves a staged import into the workspace under a new top-level page. */
  async land(manifest: ImportManifest, staging: string): Promise<ImportResult> {
    const core = this.core
    const fileHrefs = await this.moveFiles(manifest)
    const remap = (href: string): string =>
      href.startsWith(STAGED_FILE_PREFIX)
        ? (fileHrefs.get(href.slice(STAGED_FILE_PREFIX.length)) ?? '')
        : href

    const rootId = randomUUID()
    const reportId = randomUUID()
    const rootStem = await core.pageStem('', IMPORT_TITLE)
    const rootPath = `${rootStem}.md`
    const top = manifest.pages.filter((p) => p.parentId === null)
    const all: StagedPage[] = [
      {
        id: rootId,
        parentId: null,
        title: IMPORT_TITLE,
        blocks: [...top, { id: reportId }].map((p) => pageLinkBlock(p.id))
      },
      ...manifest.pages.map((p) => ({ ...p, parentId: p.parentId ?? rootId })),
      {
        id: reportId,
        parentId: rootId,
        title: REPORT_TITLE,
        blocks: reportBlocks(manifest, core.now())
      }
    ]

    const paths = new Map<string, string>([[rootId, rootPath]])
    const taken = new Map<string, Set<string>>()
    for (const page of all.slice(1)) {
      const dir = childDirOf(paths.get(page.parentId!)!)
      const names = taken.get(dir) ?? new Set<string>()
      taken.set(dir, names)
      const stem = uniqueStem(names, sanitizeTitle(page.title))
      paths.set(page.id, joinPath(dir, `${stem}.md`))
    }
    for (const [id, path] of paths) core.knownPaths.set(id, path)

    // Everything below the root page is written in staging, then moved in with one rename.
    const out = join(staging, 'out')
    const texts = new Map<string, string>()
    for (const page of all) {
      const path = paths.get(page.id)!
      const blocks = mapBlockLinks(page.blocks, remap)
      const meta: PageMeta = {
        id: page.id,
        extra: page.notionId ? { notionId: page.notionId } : {},
        ...(stemOf(path) !== page.title ? { title: page.title } : {})
      }
      const icon = page.icon && remap(page.icon)
      if (icon) meta.icon = core.metaHrefToFile(path, icon)
      const cover = page.cover && remap(page.cover)
      if (cover) meta.cover = core.toFileHref(path, cover)
      const text = serializePage(
        meta,
        mapBlockLinks(blocks, (href) => core.toFileHref(path, href))
      )
      texts.set(page.id, text)
      if (page.id === rootId) continue
      const file = join(out, ...path.split('/'))
      await mkdir(dirname(file), { recursive: true })
      await writeFileAtomic(file, text)
      core.index.set(page.id, page.title, blocksText(blocks))
    }
    await rename(join(out, rootStem), core.abs(rootStem))
    await core.writeText(rootPath, texts.get(rootId)!)
    core.index.set(rootId, IMPORT_TITLE, '')

    for (const page of all) {
      const path = paths.get(page.id)!
      const icon = page.icon && remap(page.icon)
      const record: PageRecord = {
        id: page.id,
        title: page.title,
        path,
        parentId: page.parentId,
        ...(icon ? { icon } : {})
      }
      core.pages.set(page.id, record)
      core.remember(path, texts.get(page.id)!)
      if (page.parentId) (core.state.order[page.parentId] ??= []).push(page.id)
    }
    core.insertOrder(null, rootId)
    await core.persist()
    return {
      rootId,
      reportId,
      pages: manifest.pages.length,
      issues: uniqueIssues(manifest).length
    }
  }

  /** Gives each staged file its final name in attachments/; returns key -> internal href. */
  private async moveFiles(manifest: ImportManifest): Promise<Map<string, string>> {
    const dir = this.core.abs(ATTACHMENTS_DIR)
    await mkdir(dir, { recursive: true })
    const hrefs = new Map<string, string>()
    for (const file of manifest.files) {
      if (!file.path) {
        hrefs.set(file.key, file.url ?? '')
        continue
      }
      const ext = extname(file.name)
      const base = sanitizeTitle(basename(file.name, ext)) || 'file'
      const stem = await uniqueName(dir, base, ext)
      await rename(file.path, join(dir, stem + ext))
      hrefs.set(file.key, '/' + encodeHref(`${ATTACHMENTS_DIR}/${stem}${ext}`))
    }
    return hrefs
  }
}

function uniqueStem(taken: Set<string>, stem: string): string {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? stem : `${stem} (${n})`
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase())
      return candidate
    }
  }
}

function pageLinkBlock(id: string): Block {
  return { type: 'pageLink', props: { href: pageLinkHref(id) }, children: [] }
}

function text(value: string): Inline {
  return { type: 'text', text: value, styles: {} }
}

function uniqueIssues(manifest: ImportManifest): ImportManifest['issues'] {
  const seen = new Set<string>()
  return manifest.issues.filter((i) => {
    const key = `${i.kind}\n${i.pageId}\n${i.detail}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function reportBlocks(manifest: ImportManifest, now: Date): Block[] {
  const issues = uniqueIssues(manifest)
  const seconds = Math.max(1, Math.round((now.getTime() - manifest.startedAt) / 1000))
  const sources = manifest.sources.map((s) => basename(s)).join(', ')
  const when = now.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
  const pages = manifest.pages.length
  const files = manifest.files.filter((f) => f.path).length
  const blocks: Block[] = [
    {
      type: 'paragraph',
      props: {},
      content: [
        text(
          `Imported ${pages} ${pages === 1 ? 'page' : 'pages'} and ${files} ${files === 1 ? 'file' : 'files'} ` +
            `from ${sources} on ${when}, in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`
        )
      ],
      children: []
    }
  ]
  if (issues.length === 0) {
    blocks.push({
      type: 'paragraph',
      props: {},
      content: [text('Everything was converted exactly.')],
      children: []
    })
    return blocks
  }
  const titles = new Map(manifest.pages.map((p) => [p.id, p.title || 'Untitled']))
  for (const kind of Object.keys(ISSUE_KINDS) as IssueKind[]) {
    const ofKind = issues.filter((i) => i.kind === kind)
    if (ofKind.length === 0) continue
    blocks.push({
      type: 'heading',
      props: { level: 2 },
      content: [text(`${ISSUE_KINDS[kind]} (${ofKind.length})`)],
      children: []
    })
    for (const issue of ofKind) {
      const title = titles.get(issue.pageId)
      blocks.push({
        type: 'bulletListItem',
        props: {},
        content: title
          ? [
              { type: 'link', href: pageLinkHref(issue.pageId), content: [text(title)] } as Inline,
              text(`: ${issue.detail}`)
            ]
          : [text(issue.detail)],
        children: []
      })
    }
  }
  return blocks
}
```

Apply this change to `src/main/workspace/workspace.ts`:

```diff
@@ -17,6 +17,7 @@ import { blocksText } from '../../shared/core/text'
 import type {
   FileChange,
   HistoryVersion,
+  ImportResult,
   PageDoc,
   PageMetaPatch,
   PageNode,
@@ -29,6 +30,8 @@ import { ExternalChanges, SETTLE_MS } from './external'
 import { removeDirIfEmpty, uniqueName, writeFileAtomic } from './fs-utils'
 import { LinkRewriter } from './links'
 import { PageHistory } from './page-history'
+import { PageImports } from './page-import'
+import type { ImportManifest } from '../import/types'
 import { PageTrash } from './page-trash'
 import { APP_DIR, STATE_FILE, loadState, type WorkspaceState } from './state'
 
@@ -48,6 +51,7 @@ export class Workspace {
   private readonly external: ExternalChanges
   private readonly links: LinkRewriter
   private readonly trash: PageTrash
+  private readonly imports: PageImports
 
   private constructor(
     readonly root: string,
@@ -67,6 +71,7 @@ export class Workspace {
     )
     this.links = new LinkRewriter(this.core, this.history)
     this.trash = new PageTrash(this.core, this.external, this.links, this.history)
+    this.imports = new PageImports(this.core)
   }
 
   static async open(root: string, options: WorkspaceOptions = {}): Promise<Workspace> {
@@ -119,6 +124,7 @@ export class Workspace {
     await this.history.store.prune()
     await this.run(async () => {
       for (const entry of await this.trash.store.expired()) await this.trash.delete(entry.entry)
+      await this.imports.removeStale()
     })
   }
 
@@ -406,6 +412,44 @@ export class Workspace {
     })
   }
 
+  // ---------- import ----------
+
+  /** Pages imported from Notion, by the Notion id in their frontmatter. */
+  findNotionPages(notionIds: string[]): Record<string, string> {
+    const wanted = new Set(notionIds)
+    const found: Record<string, string> = {}
+    for (const r of this.core.pages.values()) {
+      // YAML quotes an id that would otherwise read as a number.
+      const id = /^notionId: ['"]?([0-9a-f]{32})['"]?$/m.exec(
+        this.core.texts.get(r.path) ?? ''
+      )?.[1]
+      if (id && wanted.has(id)) found[id] = r.id
+    }
+    return found
+  }
+
+  /** A folder for an import to stage its pages and files in, until it lands or is discarded. */
+  createImportStaging(): Promise<string> {
+    return this.imports.createStaging()
+  }
+
+  discardImport(staging: string): Promise<void> {
+    return this.imports.discard(staging)
+  }
+
+  /** Adds a staged import as a new top-level page, then deletes its staging folder. */
+  landImport(manifest: ImportManifest, staging: string): Promise<ImportResult> {
+    return this.run(async () => {
+      try {
+        const result = await this.imports.land(manifest, staging)
+        this.core.emit({ type: 'tree' })
+        return result
+      } finally {
+        await this.imports.discard(staging)
+      }
+    })
+  }
+
   /** Saves bytes under attachments/ and returns the internal href for them. */
   saveAttachment(name: string, data: Uint8Array): Promise<string> {
     return this.run(async () => {
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: 221 unit tests pass; no type errors; ESLint reports nothing.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add src/main/workspace/import.test.ts src/main/workspace/page-import.ts src/main/workspace/workspace.ts
git commit -m "Land an import under a new page with a report"
```


---

### Task 5: Worker, import service, IPC and menu

Runs `runImport` in a worker thread (electron-vite's `?nodeWorker` import) and wraps it in `ImportService`: one import at a time, progress forwarded as `import:status` events, cancel before landing, failures with a readable message, and `stop()` for closing a workspace or quitting (which asks first while an import can still be discarded).
Adds the IPC channels for importing, peeking at dropped zips, downloading pasted images and finding imported pages, File > Import from Notion (enabled only with a workspace open), and the preload's `pathForFile` for dropped files.

**Files:**
- Create: `src/main/import/service.ts`, `src/main/import/start-worker.ts`, `src/main/import/worker.ts`
- Modify: `src/main/handlers.ts`, `src/main/index.ts`, `src/main/menu.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`
- Test: `src/main/import/service.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 4.
- Produces: `class ImportService(startWorker, onStatus)` with `running`, `cancellable`, `start(workspace, zips)`, `cancel()`, `stop()`; `interface ImportWorker`; IPC `import:choose`, `import:start`, `import:cancel`, `import:peek`, `attachment:fetch`, `notion:pages`, event `import:status`; `MenuCommand` `'import-notion'`; `type ZipKind`; `Api.pathForFile(file: File): string`; `IMPORT_MENU_ID`; `updateMenu(ctx)`; `AppContext.imports`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/import/service.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ImportStatus } from '../../shared/types'
import { Workspace } from '../workspace/workspace'
import { runImport } from './pipeline'
import { ImportService, type ImportWorker } from './service'
import { FIXTURE_ZIP } from './test-zips'
import type { WorkerInput, WorkerMessage } from './types'

/** Runs the import in-process, like the worker thread does. */
class InProcessWorker extends EventEmitter implements ImportWorker {
  terminated = false
  constructor(input: WorkerInput, hold?: Promise<void>) {
    super()
    const post = (m: WorkerMessage): void => {
      if (!this.terminated) this.emit('message', m)
    }
    void (async () => {
      await hold
      await runImport({
        ...input,
        fetch: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
        onProgress: (progress) => post({ type: 'progress', progress })
      }).then(
        (manifest) => post({ type: 'done', manifest }),
        (err: Error) => post({ type: 'error', message: err.message })
      )
    })()
  }
  async terminate(): Promise<number> {
    this.terminated = true
    return 1
  }
}

async function setup(hold?: Promise<void>): Promise<{
  ws: Workspace
  service: ImportService
  statuses: ImportStatus[]
  settled: () => Promise<ImportStatus>
}> {
  const ws = await Workspace.open(await mkdtemp(join(tmpdir(), 'nb-service-')))
  const statuses: ImportStatus[] = []
  let notify: (() => void) | null = null
  const service = new ImportService(
    (input) => new InProcessWorker(input, hold),
    (status) => {
      statuses.push(status)
      if (status.state !== 'running') notify?.()
    }
  )
  const settled = (): Promise<ImportStatus> =>
    new Promise((resolve) => {
      const last = statuses[statuses.length - 1]
      if (last && last.state !== 'running') return resolve(last)
      notify = () => resolve(statuses[statuses.length - 1])
    })
  return { ws, service, statuses, settled }
}

describe('ImportService', () => {
  it('imports, lands the pages and reports each phase', async () => {
    const { ws, service, statuses, settled } = await setup()
    await service.start(ws, [FIXTURE_ZIP])
    const done = await settled()
    expect(done).toMatchObject({ state: 'done', pages: 10 })
    const phases = statuses.flatMap((s) => (s.state === 'running' ? [s.progress.phase] : []))
    expect(new Set(phases)).toEqual(new Set(['reading', 'converting', 'copying', 'finishing']))
    expect(ws.tree().map((n) => n.title)).toEqual(['Imported from Notion'])
    expect(service.running).toBe(false)
  })

  it('refuses a second import while one runs', async () => {
    let release!: () => void
    const { ws, service } = await setup(new Promise((r) => (release = r)))
    await service.start(ws, [FIXTURE_ZIP])
    await expect(service.start(ws, [FIXTURE_ZIP])).rejects.toThrow('An import is already running.')
    release()
  })

  it('cancels before landing and deletes the staging folder', async () => {
    let release!: () => void
    const { ws, service, statuses } = await setup(new Promise((r) => (release = r)))
    await service.start(ws, [FIXTURE_ZIP])
    expect(await service.cancel()).toBe(true)
    release()
    expect(statuses[statuses.length - 1]).toEqual({ state: 'cancelled' })
    expect(ws.tree()).toEqual([])
    const appDir = await readdir(join(ws.root, '.nobsidian')).catch(() => [])
    expect(appDir.filter((n) => n.startsWith('import-'))).toEqual([])
  })

  it('reports a failed import and leaves the workspace untouched', async () => {
    const { ws, service, settled } = await setup()
    await service.start(ws, [join(ws.root, 'missing.zip')])
    expect(await settled()).toEqual({
      state: 'failed',
      message: "This file isn't a zip, or it's damaged."
    })
    expect(ws.tree()).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/main/import/service.test.ts`
Expected: FAIL with "Cannot find module './service'".

- [ ] **Step 3: Write the implementation**

Apply this change to `src/main/handlers.ts`:

```diff
@@ -1,9 +1,13 @@
-import { BrowserWindow, dialog, shell } from 'electron'
+import { BrowserWindow, dialog, Menu, shell } from 'electron'
 import { readFile } from 'node:fs/promises'
 import { basename } from 'node:path'
 import type { TreeSnapshot } from '../shared/ipc'
 import type { WorkspaceInfo } from '../shared/types'
+import { downloadImage } from './import/download'
+import type { ImportService } from './import/service'
+import { peekExport } from './import/zip'
 import { handle, send } from './ipc'
+import { IMPORT_MENU_ID } from './menu'
 import type { SettingsStore } from './settings'
 import { exists } from './workspace/fs-utils'
 import { watchWorkspace, type WorkspaceWatcher } from './workspace/watcher'
@@ -14,9 +18,16 @@ export interface AppContext {
   workspace: Workspace | null
   watcher: WorkspaceWatcher | null
   maintainTimer: ReturnType<typeof setTimeout> | null
+  imports: ImportService
   window: () => BrowserWindow | null
 }
 
+/** File > Import from Notion works only while a workspace is open. */
+export function updateMenu(ctx: AppContext): void {
+  const item = Menu.getApplicationMenu()?.getMenuItemById(IMPORT_MENU_ID)
+  if (item) item.enabled = ctx.workspace !== null
+}
+
 export function workspaceInfo(ws: Workspace): WorkspaceInfo {
   return { root: ws.root, name: basename(ws.root) }
 }
@@ -51,6 +62,7 @@ export async function openWorkspace(ctx: AppContext, root: string): Promise<Work
     },
     () => void lost()
   )
+  updateMenu(ctx)
   void ws.indexContent().catch((err) => console.error('Indexing failed', err))
   // Housekeeping can wait until the window is up.
   ctx.maintainTimer = setTimeout(() => {
@@ -63,11 +75,13 @@ export async function closeWorkspace(
   ctx: AppContext,
   { checkpoint = true }: { checkpoint?: boolean } = {}
 ): Promise<void> {
+  await ctx.imports.stop()
   const { watcher, workspace } = ctx
   if (ctx.maintainTimer) clearTimeout(ctx.maintainTimer)
   ctx.maintainTimer = null
   ctx.watcher = null
   ctx.workspace = null
+  updateMenu(ctx)
   await watcher?.close()
   if (checkpoint) await workspace?.checkpoint().catch(() => {})
   workspace?.close()
@@ -173,6 +187,32 @@ export function registerHandlers(ctx: AppContext): void {
     const file = ws().resolveAsset(href)
     if (file) await shell.openPath(file)
   })
+  handle('attachment:fetch', async ({ url }) => {
+    const image = await downloadImage(url)
+    return ws().saveAttachment(image.name, image.data)
+  })
+  handle('import:choose', async () => {
+    const win = ctx.window()
+    const options: Electron.OpenDialogOptions = {
+      title: 'Import from Notion',
+      message: 'Choose the zip files Notion exported (Export format: HTML).',
+      buttonLabel: 'Import',
+      properties: ['openFile', 'multiSelections'],
+      filters: [{ name: 'Notion export', extensions: ['zip'] }]
+    }
+    const result = win
+      ? await dialog.showOpenDialog(win, options)
+      : await dialog.showOpenDialog(options)
+    if (result.canceled || result.filePaths.length === 0) return false
+    await ctx.imports.start(ws(), result.filePaths)
+    return true
+  })
+  handle('import:start', ({ paths }) => ctx.imports.start(ws(), paths))
+  handle('import:cancel', async () => {
+    await ctx.imports.cancel()
+  })
+  handle('import:peek', ({ paths }) => Promise.all(paths.map((p) => peekExport(p))))
+  handle('notion:pages', ({ notionIds }) => ws().findNotionPages(notionIds))
   handle('settings:get', () => ctx.settings.get())
   handle('settings:set', (patch) => ctx.settings.set(patch))
   handle('shell:openExternal', async ({ url }) => {
```

Create `src/main/import/service.ts`:

```ts
import type { ImportResult, ImportStatus } from '../../shared/types'
import type { Workspace } from '../workspace/workspace'
import type { WorkerInput, WorkerMessage } from './types'

/** The part of a `worker_threads` Worker the service uses, so tests can run imports in-process. */
export interface ImportWorker {
  on(event: 'message', listener: (message: WorkerMessage) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
}

interface Running {
  workspace: Workspace
  worker: ImportWorker
  staging: string
  landing: boolean
  settled: Promise<void>
}

/** Runs one Notion import at a time and reports its status. */
export class ImportService {
  private current: Running | null = null

  constructor(
    private readonly startWorker: (input: WorkerInput) => ImportWorker,
    private readonly onStatus: (status: ImportStatus) => void
  ) {}

  get running(): boolean {
    return this.current !== null
  }

  /** Running and not yet being added to the workspace, so it can still be cancelled. */
  get cancellable(): boolean {
    return this.current !== null && !this.current.landing
  }

  /** Starts importing `zips` into `workspace`; resolves once it has started. */
  async start(workspace: Workspace, zips: string[]): Promise<void> {
    if (this.current) throw new Error('An import is already running.')
    const staging = await workspace.createImportStaging()
    let worker: ImportWorker
    try {
      worker = this.startWorker({ zips, staging })
    } catch (err) {
      await workspace.discardImport(staging)
      throw err
    }
    this.onStatus({ state: 'running', progress: { phase: 'reading', done: 0, total: 0 } })
    let finish!: () => void
    const run: Running = {
      workspace,
      worker,
      staging,
      landing: false,
      settled: new Promise((resolve) => (finish = resolve))
    }
    this.current = run
    const end = async (status: ImportStatus, discard: boolean): Promise<void> => {
      if (this.current !== run) return
      this.current = null
      if (discard) await workspace.discardImport(staging).catch(() => {})
      this.onStatus(status)
      finish()
    }
    worker.on('message', (message) => {
      if (this.current !== run || run.landing) return
      if (message.type === 'progress') {
        this.onStatus({ state: 'running', progress: message.progress })
      } else if (message.type === 'error') {
        void worker.terminate()
        void end({ state: 'failed', message: message.message }, true)
      } else {
        run.landing = true
        void worker.terminate()
        this.onStatus({ state: 'running', progress: { phase: 'finishing', done: 0, total: 0 } })
        void workspace.landImport(message.manifest, staging).then(
          (result: ImportResult) => end({ state: 'done', ...result }, false),
          (err: unknown) => end({ state: 'failed', message: landingError(err) }, true)
        )
      }
    })
    worker.on('error', (err) => {
      if (!run.landing)
        void end({ state: 'failed', message: `The import failed: ${err.message}` }, true)
    })
    worker.on('exit', () => {
      if (!run.landing)
        void end({ state: 'failed', message: 'The import stopped unexpectedly.' }, true)
    })
  }

  /** Stops a running import and deletes what it staged; too late once it is being added. */
  async cancel(): Promise<boolean> {
    const run = this.current
    if (!run || run.landing) return false
    this.current = null
    await run.worker.terminate()
    await run.workspace.discardImport(run.staging).catch(() => {})
    this.onStatus({ state: 'cancelled' })
    return true
  }

  /** Waits for a running import to finish landing, or cancels it before it lands. */
  async stop(): Promise<void> {
    const run = this.current
    if (!run) return
    if (run.landing) await run.settled
    else await this.cancel()
  }
}

function landingError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC') return 'Not enough disk space.'
  return `The import failed: ${err instanceof Error ? err.message : String(err)}`
}
```

Create `src/main/import/start-worker.ts`:

```ts
import createImportWorker from './worker?nodeWorker'
import type { ImportWorker } from './service'
import type { WorkerInput } from './types'

export function startImportWorker(input: WorkerInput): ImportWorker {
  return createImportWorker({ workerData: input })
}
```

Create `src/main/import/worker.ts`:

```ts
import { parentPort, workerData } from 'node:worker_threads'
import { runImport } from './pipeline'
import { ImportError, type WorkerInput, type WorkerMessage } from './types'

const post = (message: WorkerMessage): void => parentPort!.postMessage(message)
const input = workerData as WorkerInput

runImport({ ...input, onProgress: (progress) => post({ type: 'progress', progress }) })
  .then((manifest) => post({ type: 'done', manifest }))
  .catch((err: unknown) => {
    const message =
      err instanceof ImportError
        ? err.message
        : (err as NodeJS.ErrnoException)?.code === 'ENOSPC'
          ? 'Not enough disk space.'
          : `The import failed: ${err instanceof Error ? err.message : String(err)}`
    post({ type: 'error', message })
  })
```

Apply this change to `src/main/index.ts`:

```diff
@@ -15,7 +15,9 @@ import { join } from 'node:path'
 import { pathToFileURL } from 'node:url'
 import { is } from '@electron-toolkit/utils'
 import { ASSET_SCHEME } from '../shared/ipc'
-import { openWorkspace, registerHandlers, type AppContext } from './handlers'
+import { openWorkspace, registerHandlers, updateMenu, type AppContext } from './handlers'
+import { ImportService } from './import/service'
+import { startImportWorker } from './import/start-worker'
 import { send } from './ipc'
 import { buildMenu } from './menu'
 import { SettingsStore } from './settings'
@@ -43,6 +45,9 @@ const ctx: AppContext = {
   workspace: null,
   watcher: null,
   maintainTimer: null,
+  imports: new ImportService(startImportWorker, (status) => {
+    if (mainWindow) send(mainWindow.webContents, 'import:status', status)
+  }),
   window: () => mainWindow
 }
 
@@ -103,6 +108,20 @@ function createWindow(): void {
     event.preventDefault()
     if (closing) return
     closing = true
+    if (ctx.imports.running) {
+      // An import being added finishes first; one still reading can be discarded.
+      const ask = ctx.imports.cancellable ? discardImport(win, quitting) : Promise.resolve(true)
+      void ask.then(async (discard) => {
+        closing = false
+        if (!discard) {
+          quitting = false
+          return
+        }
+        await ctx.imports.stop()
+        win.close()
+      })
+      return
+    }
     const saving = ctx.settings.set({ windowBounds: win.getNormalBounds() }).catch(() => {})
     let answered = false
     const finish = async (saved: boolean): Promise<void> => {
@@ -134,6 +153,20 @@ function createWindow(): void {
   else void win.loadFile(join(__dirname, '../renderer/index.html'))
 }
 
+/** Asks before closing while an import runs; true discards it. */
+async function discardImport(win: BrowserWindow, quitting: boolean): Promise<boolean> {
+  const verb = quitting ? 'Quit' : 'Close'
+  const { response } = await dialog.showMessageBox(win, {
+    type: 'warning',
+    message: `An import is running. ${verb} and discard it?`,
+    detail: 'Nothing from it has been added yet.',
+    buttons: ['Cancel', `${verb} and Discard`],
+    defaultId: 0,
+    cancelId: 0
+  })
+  return response === 1
+}
+
 /** Asks before closing over edits the renderer could not save; they are still on screen. */
 async function closeAnyway(win: BrowserWindow, quitting: boolean): Promise<boolean> {
   const verb = quitting ? 'Quit' : 'Close'
@@ -167,6 +200,7 @@ app.whenReady().then(async () => {
 
   registerHandlers(ctx)
   Menu.setApplicationMenu(buildMenu(() => mainWindow))
+  updateMenu(ctx)
   createWindow()
 
   app.on('activate', () => {
```

Apply this change to `src/main/menu.ts`:

```diff
@@ -2,6 +2,8 @@ import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from '
 import type { MenuCommand } from '../shared/ipc'
 import { send } from './ipc'
 
+export const IMPORT_MENU_ID = 'import-notion'
+
 export function buildMenu(getWindow: () => BrowserWindow | null): Menu {
   const command = (cmd: MenuCommand) => (): void => {
     const win = getWindow()
@@ -15,6 +17,13 @@ export function buildMenu(getWindow: () => BrowserWindow | null): Menu {
         { label: 'New Page', accelerator: 'CmdOrCtrl+N', click: command('new-page') },
         { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: command('open-folder') },
         { type: 'separator' },
+        {
+          id: IMPORT_MENU_ID,
+          label: 'Import from Notion…',
+          enabled: false,
+          click: command('import-notion')
+        },
+        { type: 'separator' },
         { role: 'close' }
       ]
     },
```

Apply this change to `src/preload/index.ts`:

```diff
@@ -1,4 +1,4 @@
-import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
+import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
 import type { Api, IpcEvents } from '../shared/ipc'
 
 const api: Api = {
@@ -7,7 +7,8 @@ const api: Api = {
     const wrapped = (_e: IpcRendererEvent, data: IpcEvents[typeof event]): void => listener(data)
     ipcRenderer.on(event, wrapped)
     return () => ipcRenderer.removeListener(event, wrapped)
-  }
+  },
+  pathForFile: (file) => webUtils.getPathForFile(file)
 }
 
 contextBridge.exposeInMainWorld('api', api)
```

Apply this change to `src/shared/ipc.ts`:

```diff
@@ -1,6 +1,7 @@
 import type { Block } from './core/blocks'
 import type {
   HistoryVersion,
+  ImportStatus,
   PageDoc,
   PageMetaPatch,
   PageNode,
@@ -37,7 +38,17 @@ export interface TreeSnapshot {
 }
 
 export type MenuCommand =
-  'new-page' | 'open-folder' | 'search' | 'toggle-sidebar' | 'toggle-theme' | 'back' | 'forward'
+  | 'new-page'
+  | 'open-folder'
+  | 'import-notion'
+  | 'search'
+  | 'toggle-sidebar'
+  | 'toggle-theme'
+  | 'back'
+  | 'forward'
+
+/** What a dropped zip is, judged from its file names. */
+export type ZipKind = 'notion-html' | 'notion-markdown' | 'other'
 
 export interface IpcContract {
   'workspace:current': [payload: void, result: WorkspaceInfo | null]
@@ -71,6 +82,15 @@ export interface IpcContract {
   'attachment:save': [payload: { name: string; data: Uint8Array }, result: string]
   'attachment:chooseImage': [payload: void, result: string | null]
   'attachment:open': [payload: { href: string }, result: void]
+  /** Downloads an image from the web into attachments/; returns its internal href. */
+  'attachment:fetch': [payload: { url: string }, result: string]
+  /** Picks Notion export zips and starts importing them; false if the picker was cancelled. */
+  'import:choose': [payload: void, result: boolean]
+  'import:start': [payload: { paths: string[] }, result: void]
+  'import:cancel': [payload: void, result: void]
+  'import:peek': [payload: { paths: string[] }, result: ZipKind[]]
+  /** Imported pages by Notion id (32 hex), for pasted links to them. */
+  'notion:pages': [payload: { notionIds: string[] }, result: Record<string, string>]
   'settings:get': [payload: void, result: Settings]
   'settings:set': [payload: Partial<Settings>, result: Settings]
   'shell:openExternal': [payload: { url: string }, result: void]
@@ -87,11 +107,14 @@ export interface IpcEvents {
   'workspace:missing': void
   'menu:command': MenuCommand
   'app:flush': void
+  'import:status': ImportStatus
 }
 
 export interface Api {
   invoke<C extends IpcChannel>(channel: C, payload: IpcPayload<C>): Promise<IpcResult<C>>
   on<E extends keyof IpcEvents>(event: E, listener: (data: IpcEvents[E]) => void): () => void
+  /** The path of a file dropped on the window. */
+  pathForFile(file: File): string
 }
 
 export const ASSET_SCHEME = 'nbfile'
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm exec vitest run && pnpm typecheck && pnpm lint && pnpm exec electron-vite build && pnpm exec playwright test`
Expected: 225 unit tests and the 46 existing end-to-end tests pass.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add src/main/handlers.ts src/main/import/service.test.ts src/main/import/service.ts src/main/import/start-worker.ts src/main/import/worker.ts src/main/index.ts src/main/menu.ts src/preload/index.ts src/shared/ipc.ts
git commit -m "Run imports in a worker behind an import service"
```


---

### Task 6: Import UI: progress panel, drop target, report

The bottom-right progress panel (reading, converting, copying, finishing, with Cancel until finishing; then Open and Open report, or the failure), the File > Import from Notion command, and dropping zips on the window: a Notion HTML export asks "Import this file from Notion?", dropped into a page it also offers "Attach as file", a Markdown export or another zip says so.
The packaged app is checked to import the fixture with its worker inside the app archive, and `tests/` is kept out of the package.

**Files:**
- Create: `src/renderer/src/components/ImportDrop.tsx`, `src/renderer/src/components/ImportPanel.tsx`, `src/renderer/src/editor/attachFiles.ts`
- Modify: `electron-builder.yml`, `src/renderer/src/App.tsx`, `src/renderer/src/components/Modal.tsx`, `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/store.ts`, `src/renderer/src/styles/app.css`
- Test: `e2e-packaged/packaged.spec.ts`, `e2e/import.spec.ts`

**Interfaces:**
- Consumes: Task 5's IPC, events and menu command; `ConfirmDialog`.
- Produces: `ImportPanel`, `ImportDrop`; `ConfirmDialog` prop `extra?: { label; onSelect }`; store `importStatus`, `showMessage`, `startImport(paths?)`, `cancelImport()`, `setImportStatus()`; `ATTACH_FILES_EVENT`, `insertAtCursor(editor, blocks)`.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `e2e-packaged/packaged.spec.ts` with:

```ts
import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchElectron } from '../e2e/launch'

const APP = resolve('dist/mac-arm64/Nobsidian.app/Contents/MacOS/Nobsidian')

test('the packaged app launches to the welcome screen', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-packaged-'))
  const app = await launchElectron({
    executablePath: APP,
    env: { NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page.getByText('Welcome to Nobsidian')).toBeVisible()
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  await app.close()
})

test('the packaged app imports a Notion export in its worker', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-packaged-'))
  const workspace = await mkdtemp(join(tmpdir(), 'nobsidian-packaged-ws-'))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ lastWorkspace: workspace }))
  const app = await launchElectron({
    executablePath: APP,
    env: { NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible()
  await app.evaluate(
    ({ dialog, Menu }, filePaths) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths
      })) as typeof dialog.showOpenDialog
      Menu.getApplicationMenu()!.getMenuItemById('import-notion')!.click()
    },
    [resolve('tests/fixtures/notion-export.zip')]
  )
  // External images are not served here, so some downloads may be reported.
  await expect(page.getByRole('status')).toContainText('Imported 10 pages')
  await app.close()
})
```

Create `e2e/import.spec.ts`:

```ts
import { createServer, type Server } from 'node:http'
import { createWriteStream } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ElectronApplication } from '@playwright/test'
import yazl from 'yazl'
import { expect, test } from './fixtures'
import { editor, waitForFile } from './helpers'

const FIXTURES = resolve('tests/fixtures')
const EXPORT_ZIP = join(FIXTURES, 'notion-export.zip')

// "Web" images the export links to are served locally.
let server: Server
test.beforeAll(async () => {
  const png = await readFile(join(FIXTURES, 'web-image.png'))
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(png)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  process.env.NOBSIDIAN_E2E_WEB = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => server.close())

async function importViaMenu(app: ElectronApplication, zips: string[]): Promise<void> {
  await app.evaluate(({ dialog, Menu }, filePaths) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths
    })) as typeof dialog.showOpenDialog
    Menu.getApplicationMenu()!.getMenuItemById('import-notion')!.click()
  }, zips)
}

test('imports a Notion export with its pages, images, colors and links', async ({ nb }) => {
  const { app, page } = nb
  await importViaMenu(app, [EXPORT_ZIP])
  const panel = page.getByRole('status')
  await expect(panel).toContainText('Imported 10 pages. 2 things need a look.')
  await panel.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByTestId('page-title')).toHaveText('Imported from Notion')

  await page.getByTestId('sidebar-row-Nobsidian import fixture').click()
  await expect(page.getByTestId('page-title')).toHaveText('Nobsidian import fixture')
  const body = page.locator(editor)
  await expect(body.getByRole('heading', { name: 'Heading 1', exact: true })).toBeVisible()
  await expect(body.locator('[data-style-type="textColor"][data-value="red"]').first()).toHaveText(
    'red'
  )
  await expect(body.getByText('An orange callout with a custom icon')).toBeVisible()
  await expect(body.getByText('🚧')).toBeVisible()
  const image = body
    .locator('img[alt="An uploaded image with a caption"], .bn-visual-media')
    .first()
  await expect(image).toBeVisible()
  await expect(page.getByTestId('page-cover')).toBeVisible()

  // A page mention leads to the imported page.
  await body.getByRole('link', { name: 'Grandchild page' }).first().click()
  await expect(page.getByTestId('page-title')).toHaveText('Grandchild page')

  const root = join(nb.workspace, 'Imported from Notion')
  expect((await readdir(join(nb.workspace, 'attachments'))).sort()).toEqual([
    'fixture-image.png',
    'fixture-report.pdf',
    'gradients_2.png',
    'gradients_8.png'
  ])
  await waitForFile(join(root, 'Nobsidian import fixture.md'), '> [!callout:orange_bg] 🚧')
  const report = await readFile(join(root, 'Import report.md'), 'utf8')
  expect(report).toContain('## Table formatting not kept (2)')
  expect(await readdir(join(nb.workspace, '.nobsidian'))).not.toContainEqual(
    expect.stringMatching(/^import-/)
  )
})

test('a second import lands next to the first one', async ({ nb }) => {
  const { app, page } = nb
  await importViaMenu(app, [EXPORT_ZIP])
  await expect(page.getByRole('status')).toContainText('Imported 10 pages')
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await importViaMenu(app, [EXPORT_ZIP])
  await expect(page.getByRole('status')).toContainText('Imported 10 pages')
  await expect(page.getByTestId('sidebar-row-Imported from Notion')).toHaveCount(2)
  await waitForFile(join(nb.workspace, 'Imported from Notion (2).md'), 'id:')
  expect(await readdir(join(nb.workspace, 'attachments'))).toContain('fixture-image (2).png')
})

test('cancelling an import leaves nothing behind', async ({ nb }) => {
  const big = join(nb.userData, 'big-export.zip')
  await writeBigExport(big, 1500)
  const { app, page } = nb
  await importViaMenu(app, [big])
  const panel = page.getByRole('status')
  await expect(panel).toContainText('Converting pages')
  await panel.getByRole('button', { name: 'Cancel' }).click()
  await expect(panel).toContainText('Cancelled, nothing was imported.')
  await expect(page.getByTestId('sidebar-row-Imported from Notion')).toHaveCount(0)
  const appDir = await readdir(join(nb.workspace, '.nobsidian')).catch(() => [])
  expect(appDir.filter((name) => name.startsWith('import-'))).toEqual([])
})

test('a zip that is not a Notion HTML export is refused', async ({ nb }) => {
  const zip = join(nb.userData, 'notes.zip')
  const out = new yazl.ZipFile()
  out.addBuffer(Buffer.from('# Notes\n'), 'Notes 0123456789abcdef0123456789abcdef.md')
  out.end()
  await pipeline(out.outputStream, createWriteStream(zip))
  await importViaMenu(nb.app, [zip])
  await expect(nb.page.getByRole('alert')).toContainText(
    'This is a Markdown export. Export again as HTML.'
  )
  await expect(nb.page.getByTestId('sidebar-row-Imported from Notion')).toHaveCount(0)
})

async function writeBigExport(path: string, pages: number): Promise<void> {
  const zip = new yazl.ZipFile()
  const paragraph = `<p>${'Some words in a long paragraph. '.repeat(40)}</p>`.repeat(30)
  for (let i = 0; i < pages; i++) {
    const id = i.toString(16).padStart(32, '0')
    const html =
      `<html><body><article class="page"><header><h1 class="page-title">Page ${i}</h1></header>` +
      `<div class="page-body">${paragraph}</div></article></body></html>`
    zip.addBuffer(Buffer.from(html), `Private & Shared/Page ${i} ${id}.html`)
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path))
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec electron-vite build && pnpm exec playwright test e2e/import.spec.ts`
Expected: FAIL. All four tests time out waiting for the import panel (`getByRole('status')`).

- [ ] **Step 3: Write the implementation**

Apply this change to `electron-builder.yml`:

```diff
@@ -10,7 +10,7 @@ files:
   - '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,.editorconfig,.nvmrc,README.md,LICENSE}'
   - '!{.env,.env.*,.npmrc,pnpm-lock.yaml}'
   - '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
-  - '!{vitest.config.*,playwright.config.*,e2e/*,e2e-packaged/*,test-results/*,playwright-report/*,*.tsbuildinfo}'
+  - '!{vitest.config.*,playwright.config.*,e2e/*,e2e-packaged/*,tests/*,test-results/*,playwright-report/*,*.tsbuildinfo}'
   # Renderer code is bundled by Vite; only main-process dependencies ship in node_modules.
   - '!{.superpowers,.impeccable,.claude,.github}/**'
 asarUnpack:
```

Apply this change to `src/renderer/src/App.tsx`:

```diff
@@ -1,5 +1,7 @@
 import { useEffect } from 'react'
 import { HistoryModal } from './components/HistoryModal'
+import { ImportDrop } from './components/ImportDrop'
+import { ImportPanel } from './components/ImportPanel'
 import { PageView } from './components/PageView'
 import { SearchModal } from './components/SearchModal'
 import { Sidebar } from './components/Sidebar'
@@ -41,6 +43,7 @@ export function App(): React.JSX.Element | null {
         .then((saved) => api.invoke('app:flushed', { saved }))
     })
     const offMissing = api.on('workspace:missing', () => useApp.getState().workspaceMissing())
+    const offImport = api.on('import:status', (status) => useApp.getState().setImportStatus(status))
     // Cmd+K opens search unless the editor used it to add a link to selected text.
     const onKey = (e: KeyboardEvent): void => {
       if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'k') return
@@ -53,6 +56,7 @@ export function App(): React.JSX.Element | null {
       offTree()
       offFlush()
       offMissing()
+      offImport()
       window.removeEventListener('keydown', onKey)
     }
   }, [])
@@ -63,6 +67,7 @@ export function App(): React.JSX.Element | null {
         const app = useApp.getState()
         if (cmd === 'new-page') void app.createPage(null)
         if (cmd === 'open-folder') void app.chooseWorkspace()
+        if (cmd === 'import-notion' && app.workspace) void app.startImport()
         if (cmd === 'search' && canSearch()) app.setOverlay({ kind: 'search' })
         if (cmd === 'back') app.back()
         if (cmd === 'forward') app.forward()
@@ -89,6 +94,8 @@ export function App(): React.JSX.Element | null {
           {overlay?.kind === 'search' && <SearchModal />}
           {overlay?.kind === 'move' && <SearchModal moving={overlay.pageId} />}
           {overlay?.kind === 'history' && <HistoryModal pageId={overlay.pageId} theme={theme} />}
+          <ImportDrop />
+          <ImportPanel />
         </>
       )}
       {error && (
```

Create `src/renderer/src/components/ImportDrop.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { ATTACH_FILES_EVENT } from '../editor/attachFiles'
import { useApp } from '../store'
import { ConfirmDialog } from './Modal'

const api = window.api

interface Pending {
  paths: string[]
  /** Dropped into the editor, where a zip is otherwise attached as a file. */
  files: File[] | null
}

const isZip = (file: File): boolean => /\.zip$/i.test(file.name)
const inEditor = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('.bn-editor') !== null
// Notion names its exports `<id>_ExportBlock-<id>.zip` or `Export-<id>.zip`.
const notionName = (file: File): boolean => /export/i.test(file.name)
const hasZip = (e: DragEvent): boolean =>
  [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file' && /zip/.test(i.type))

/** Zips dropped on the window start a Notion import once their contents look like one. */
export function ImportDrop(): React.JSX.Element | null {
  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      if (!hasZip(e) || inEditor(e.target)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent): void => {
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length === 0 || !files.every(isZip)) return
      const editor = inEditor(e.target)
      // Other zips dropped into a page are attached as before.
      if (editor && !files.every(notionName)) return
      e.preventDefault()
      e.stopPropagation()
      void check(files, editor)
    }
    const check = async (files: File[], editor: boolean): Promise<void> => {
      const app = useApp.getState()
      if (!app.workspace) return
      const paths = files.map((f) => api.pathForFile(f))
      const kinds = await api.invoke('import:peek', { paths }).catch(() => null)
      if (!kinds) return
      const notion = paths.filter((_, i) => kinds[i] === 'notion-html')
      if (notion.length > 0) {
        setPending({ paths: notion, files: editor ? files : null })
      } else if (kinds.includes('notion-markdown')) {
        app.showMessage('This is a Markdown export. Export again as HTML.')
      } else if (editor) {
        attach(files)
      } else {
        app.showMessage("This zip isn't a Notion HTML export.")
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [])

  if (!pending) return null
  const count = pending.paths.length
  return (
    <ConfirmDialog
      title={`Import ${count === 1 ? 'this file' : `${count} files`} from Notion?`}
      message="Its pages will be added under “Imported from Notion”."
      confirmLabel="Import"
      extra={
        pending.files
          ? { label: 'Attach as file', onSelect: () => attach(pending.files!) }
          : undefined
      }
      onConfirm={() => void useApp.getState().startImport(pending.paths)}
      onClose={() => setPending(null)}
    />
  )
}

function attach(files: File[]): void {
  window.dispatchEvent(new CustomEvent(ATTACH_FILES_EVENT, { detail: files }))
}
```

Create `src/renderer/src/components/ImportPanel.tsx`:

```tsx
import type { ImportProgress, ImportStatus } from '@shared/types'
import { useApp } from '../store'
import { CloseIcon } from './icons'

function progressLine(p: ImportProgress): string {
  if (p.phase === 'reading') return 'Reading export…'
  if (p.phase === 'finishing') return 'Finishing…'
  const what = p.phase === 'converting' ? 'Converting pages' : 'Copying images and files'
  return `${what} · ${p.done} of ${p.total}`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function summary(status: Exclude<ImportStatus, { state: 'running' }>): string {
  if (status.state === 'cancelled') return 'Cancelled, nothing was imported.'
  if (status.state === 'failed') return status.message
  const pages = `Imported ${plural(status.pages, 'page', 'pages')}.`
  if (status.issues === 0) return pages
  return `${pages} ${plural(status.issues, 'thing needs', 'things need')} a look.`
}

/** The bottom-right card that follows a Notion import; editing carries on underneath it. */
export function ImportPanel(): React.JSX.Element | null {
  const status = useApp((s) => s.importStatus)
  if (!status) return null
  const app = useApp.getState
  const dismiss = (): void => app().setImportStatus(null)
  const open = (id: string, rootId: string): void => {
    void app().setExpanded(rootId, true)
    app().openPage(id)
    dismiss()
  }

  if (status.state === 'running') {
    const p = status.progress
    const fraction = p.total > 0 ? p.done / p.total : null
    return (
      <div className="import-panel" role="status" aria-live="polite">
        <div className="import-panel-title">Importing from Notion</div>
        <div className="import-panel-line">{progressLine(p)}</div>
        <div className="import-panel-bar">
          <div
            className={fraction === null ? 'import-panel-fill indeterminate' : 'import-panel-fill'}
            style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
        {p.phase !== 'finishing' && (
          <div className="import-panel-actions">
            <button className="button-secondary" onClick={() => void app().cancelImport()}>
              Cancel
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={status.state === 'failed' ? 'import-panel failed' : 'import-panel'}
      role={status.state === 'failed' ? 'alert' : 'status'}
    >
      <div className="import-panel-head">
        <div className="import-panel-title">
          {status.state === 'failed' ? "Couldn't import from Notion" : 'Import from Notion'}
        </div>
        <button className="icon-button" aria-label="Dismiss" onClick={dismiss}>
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="import-panel-line">{summary(status)}</div>
      {status.state === 'done' && (
        <div className="import-panel-actions">
          <button className="button-primary" onClick={() => open(status.rootId, status.rootId)}>
            Open
          </button>
          <button className="button-secondary" onClick={() => open(status.reportId, status.rootId)}>
            Open report
          </button>
        </div>
      )}
    </div>
  )
}
```

Apply this change to `src/renderer/src/components/Modal.tsx`:

```diff
@@ -100,6 +100,7 @@ export function ConfirmDialog({
   message,
   confirmLabel,
   danger,
+  extra,
   onConfirm,
   onClose
 }: {
@@ -107,6 +108,8 @@ export function ConfirmDialog({
   message?: string
   confirmLabel: string
   danger?: boolean
+  /** A second way to go ahead, shown between the main button and Cancel. */
+  extra?: { label: string; onSelect: () => void }
   onConfirm: () => void
   onClose: () => void
 }): React.JSX.Element {
@@ -129,6 +132,17 @@ export function ConfirmDialog({
         >
           {confirmLabel}
         </button>
+        {extra && (
+          <button
+            className="button-secondary"
+            onClick={() => {
+              onClose()
+              extra.onSelect()
+            }}
+          >
+            {extra.label}
+          </button>
+        )}
         <button className="button-secondary" autoFocus={danger} onClick={onClose}>
           Cancel
         </button>
```

Apply this change to `src/renderer/src/editor/Editor.tsx`:

```diff
@@ -23,6 +23,8 @@ import {
 } from '@blocknote/react'
 import { locales as multiColumnLocales, multiColumnDropCursor } from '@blocknote/xl-multi-column'
 import { createContext, useContext, useEffect } from 'react'
+import type { Block } from '@shared/core/blocks'
+import { ATTACH_FILES_EVENT, insertAtCursor } from './attachFiles'
 import { AppColorStyleButton } from './ColorButton'
 import { ColorPickContext, type PickedColor } from './colors'
 import { AppCreateLinkButton, AppEditLinkButton } from './LinkButtons'
@@ -152,6 +154,23 @@ export function Editor(props: EditorProps): React.JSX.Element {
     }
   })
 
+  const { uploadFile, editable } = props
+  useEffect(() => {
+    if (editable === false) return
+    const attach = (event: Event): void => {
+      const files = (event as CustomEvent<File[]>).detail
+      void Promise.all(
+        files.map(async (file): Promise<Block> => ({
+          type: 'file',
+          props: { url: await uploadFile(file), name: file.name },
+          children: []
+        }))
+      ).then((blocks) => insertAtCursor(editor, blocks))
+    }
+    window.addEventListener(ATTACH_FILES_EVENT, attach)
+    return () => window.removeEventListener(ATTACH_FILES_EVENT, attach)
+  }, [editor, uploadFile, editable])
+
   return (
     <PageLinkContext.Provider value={props.pageLink}>
       <OpenLinkContext.Provider value={props.openLink}>
```

Create `src/renderer/src/editor/attachFiles.ts`:

```ts
import type { Block } from '@shared/core/blocks'
import type { AppEditor, AppPartialBlock } from './schema'

/** Window event asking the open editor to attach dropped files at the cursor. */
export const ATTACH_FILES_EVENT = 'nobsidian:attach-files'

/** Puts blocks after the cursor's block, or in its place when that block is an empty paragraph. */
export function insertAtCursor(editor: AppEditor, blocks: Block[]): void {
  if (blocks.length === 0) return
  const partial = blocks as unknown as AppPartialBlock[]
  const cursor = editor.getTextCursorPosition().block
  const empty =
    cursor.type === 'paragraph' &&
    Array.isArray(cursor.content) &&
    cursor.content.length === 0 &&
    cursor.children.length === 0
  if (empty) editor.replaceBlocks([cursor], partial)
  else editor.insertBlocks(partial, cursor, 'after')
}
```

Apply this change to `src/renderer/src/store.ts`:

```diff
@@ -1,7 +1,7 @@
 import { create } from 'zustand'
 import type { Block } from '@shared/core/blocks'
 import { RECENT_LIMIT, type Settings, type TreeSnapshot } from '@shared/ipc'
-import type { PageNode, WorkspaceInfo } from '@shared/types'
+import type { ImportStatus, PageNode, WorkspaceInfo } from '@shared/types'
 import { findNode, firstPageId } from './lib/tree'
 
 const api = window.api
@@ -52,6 +52,8 @@ interface AppState {
   confirms: number
   /** Rescued edits by page id, waiting for that page's editor to show them again. */
   rescued: Record<string, Rescue>
+  /** The Notion import shown in the progress panel; null once dismissed. */
+  importStatus: ImportStatus | null
 
   init: () => Promise<void>
   chooseWorkspace: () => Promise<void>
@@ -76,6 +78,11 @@ interface AppState {
   reportError: (action: string, err: unknown) => Promise<void>
   rescue: (id: string, rescue: Rescue) => Promise<void>
   takeRescued: (id: string) => void
+  showMessage: (message: string) => void
+  /** Imports these zips, or asks which ones when none are given. */
+  startImport: (paths?: string[]) => Promise<void>
+  cancelImport: () => Promise<void>
+  setImportStatus: (status: ImportStatus | null) => void
 }
 
 function errorReason(err: unknown): string {
@@ -99,6 +106,7 @@ export const useApp = create<AppState>((set, get) => ({
   trashEntry: null,
   confirms: 0,
   rescued: {},
+  importStatus: null,
 
   init: async () => {
     const [settings, workspace] = await Promise.all([
@@ -273,6 +281,23 @@ export const useApp = create<AppState>((set, get) => ({
   setRenaming: (id) => set({ renamingId: id }),
 
   /** Shows what failed and re-syncs the sidebar with what is actually on disk. */
+  showMessage: (message) => showError(message),
+
+  startImport: async (paths) => {
+    try {
+      if (paths) await api.invoke('import:start', { paths })
+      else await api.invoke('import:choose', undefined)
+    } catch (e) {
+      showError(errorReason(e))
+    }
+  },
+
+  cancelImport: async () => {
+    await api.invoke('import:cancel', undefined).catch(() => {})
+  },
+
+  setImportStatus: (importStatus) => set({ importStatus }),
+
   reportError: async (action, err) => {
     showError(`Couldn't ${action} the page: ${errorReason(err)}`)
     const snapshot = await api.invoke('tree:get', undefined).catch(() => null)
```

Apply this change to `src/renderer/src/styles/app.css`:

```diff
@@ -971,3 +971,81 @@ button.breadcrumb:hover {
 .history-footer .button-primary {
   width: 100%;
 }
+
+/* ---------- Notion import ---------- */
+.import-panel {
+  position: fixed;
+  right: 20px;
+  bottom: 20px;
+  width: 300px;
+  padding: 14px 16px;
+  border-radius: 8px;
+  background: var(--menu-bg);
+  box-shadow: var(--menu-shadow);
+  font-size: 14px;
+  z-index: 150;
+}
+.import-panel-head {
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  gap: 8px;
+}
+.import-panel-head .icon-button {
+  color: var(--text-tertiary);
+}
+.import-panel-title {
+  font-weight: 500;
+}
+.import-panel.failed .import-panel-title {
+  color: var(--color-red);
+}
+.import-panel-line {
+  margin-top: 4px;
+  color: var(--text-secondary);
+  font-size: 13px;
+  font-variant-numeric: tabular-nums;
+}
+.import-panel-bar {
+  position: relative;
+  height: 4px;
+  margin-top: 10px;
+  border-radius: 2px;
+  background: var(--hover-strong);
+  overflow: hidden;
+}
+.import-panel-fill {
+  height: 100%;
+  border-radius: 2px;
+  background: var(--accent);
+  transition: width 150ms ease-out;
+}
+.import-panel-fill.indeterminate {
+  width: 30%;
+  animation: import-slide 1.2s ease-in-out infinite;
+}
+@keyframes import-slide {
+  from {
+    transform: translateX(-100%);
+  }
+  to {
+    transform: translateX(340%);
+  }
+}
+@media (prefers-reduced-motion: reduce) {
+  .import-panel-fill.indeterminate {
+    animation: none;
+    width: 100%;
+    opacity: 0.4;
+  }
+}
+.import-panel-actions {
+  display: flex;
+  gap: 8px;
+  margin-top: 12px;
+}
+.import-panel-actions button {
+  font-size: 13px;
+  padding-top: 5px;
+  padding-bottom: 5px;
+}
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm test:packaged`
Expected: 225 unit tests, 50 end-to-end tests and both packaged-app tests pass.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add e2e-packaged/packaged.spec.ts e2e/import.spec.ts electron-builder.yml src/renderer/src/App.tsx src/renderer/src/components/ImportDrop.tsx src/renderer/src/components/ImportPanel.tsx src/renderer/src/components/Modal.tsx src/renderer/src/editor/Editor.tsx src/renderer/src/editor/attachFiles.ts src/renderer/src/store.ts src/renderer/src/styles/app.css
git commit -m "Add the Notion import panel, menu and drop target"
```


---

### Task 7: Paste from Notion

Maps Notion's private clipboard records to blocks (rich text marks, colors, mentions, dates, callouts, columns, tables, to-dos, toggles), taking mention titles and person names from the `text/html` copy and a synced block's content from it too, and falls back to mapping the HTML copy.
The editor's paste handler recognizes Notion content, links mentions of pages imported earlier to them, downloads web images, and inserts the blocks at the cursor; uploaded files become a note and a toast.

**Files:**
- Create: `src/renderer/src/editor/notionPaste.ts`, `src/shared/notion/paste.ts`, `src/shared/notion/records.ts`
- Modify: `src/renderer/src/components/PageEditor.tsx`, `src/renderer/src/editor/Editor.tsx`
- Test: `e2e/import.spec.ts`, `src/shared/notion/records.test.ts`, `tests/fixtures/notion-clipboard/expected.md`

**Interfaces:**
- Consumes: `mapNotionFragment`, `notionColor`, `MapContext` (Task 1); `notion:pages`, `attachment:fetch` (Task 5); `insertAtCursor`, `showMessage` (Task 6).
- Produces: `mapNotionRecords(json, ctx, names): Block[] | null`, `NOTION_RECORDS_TYPE`, `interface PasteNames`; `readNotionClipboard(data): NotionClipboard | null`, `notionPageIds(clipboard)`, `mapNotionPaste(clipboard, ctx)`; `prepareNotionPaste(clipboard): Promise<{ blocks; uploads }>`; `Editor` prop `pasteNotion?(clipboard): Promise<Block[]>`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `e2e/import.spec.ts`:

```diff
@@ -7,7 +7,7 @@ import { pipeline } from 'node:stream/promises'
 import type { ElectronApplication } from '@playwright/test'
 import yazl from 'yazl'
 import { expect, test } from './fixtures'
-import { editor, waitForFile } from './helpers'
+import { editor, newPage, waitForFile } from './helpers'
 
 const FIXTURES = resolve('tests/fixtures')
 const EXPORT_ZIP = join(FIXTURES, 'notion-export.zip')
@@ -116,6 +116,64 @@ test('a zip that is not a Notion HTML export is refused', async ({ nb }) => {
   await expect(nb.page.getByTestId('sidebar-row-Imported from Notion')).toHaveCount(0)
 })
 
+test('pasting from Notion keeps colors, callouts and toggles', async ({ nb }) => {
+  const { app, page } = nb
+  const html = await readFile(join(FIXTURES, 'notion-clipboard', 'page.html'), 'utf8')
+  const records = await readFile(join(FIXTURES, 'notion-clipboard', 'records.json'), 'utf8')
+  await newPage(page, 'Pasted')
+  // Notion's own copy: its HTML plus its block records as Chromium custom data.
+  await app.evaluate(
+    async ({ clipboard, ClipboardItem }, { html, custom }) => {
+      const raw = 'electron application/osclipboard;format="org.chromium.web-custom-data"'
+      await clipboard.write([
+        new ClipboardItem({
+          'text/html': html,
+          'text/plain': 'Notion',
+          [raw]: new Blob([Buffer.from(custom, 'base64')])
+        })
+      ])
+    },
+    {
+      html,
+      custom: chromiumCustomData({ 'text/_notion-blocks-v3-production': records }).toString(
+        'base64'
+      )
+    }
+  )
+  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste())
+  const body = page.locator(editor)
+  await expect(body.getByText('An orange callout with a custom icon')).toBeVisible()
+  await expect(
+    body.locator('[data-style-type="backgroundColor"][data-value="yellow"]').first()
+  ).toBeVisible()
+  const file = join(nb.workspace, 'Pasted.md')
+  const text = await waitForFile(file, '> [!callout:orange_bg] 🚧')
+  expect(text).toContain('<details data-heading="1">')
+  expect(text).toContain('*Image from Notion: fixture-image.png*')
+  await expect(page.getByRole('alert')).toContainText(
+    "Images and files uploaded to Notion can't be pasted"
+  )
+})
+
+/** Chromium's clipboard format for custom MIME types: a pickle of UTF-16 type/value pairs. */
+function chromiumCustomData(entries: Record<string, string>): Buffer {
+  const parts: Buffer[] = []
+  const u32 = (n: number): Buffer => {
+    const b = Buffer.alloc(4)
+    b.writeUInt32LE(n)
+    return b
+  }
+  const string16 = (s: string): Buffer => {
+    const data = Buffer.from(s, 'utf16le')
+    const pad = (4 - (data.length % 4)) % 4
+    return Buffer.concat([u32(s.length), data, Buffer.alloc(pad)])
+  }
+  parts.push(u32(Object.keys(entries).length))
+  for (const [type, value] of Object.entries(entries)) parts.push(string16(type), string16(value))
+  const payload = Buffer.concat(parts)
+  return Buffer.concat([u32(payload.length), payload])
+}
+
 async function writeBigExport(path: string, pages: number): Promise<void> {
   const zip = new yazl.ZipFile()
   const paragraph = `<p>${'Some words in a long paragraph. '.repeat(40)}</p>`.repeat(30)
```

Create `src/shared/notion/records.test.ts`:

```ts
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
```

Create `tests/fixtures/notion-clipboard/expected.md` (the reviewed output it must match):

````markdown
This page is a test fixture for Nobsidian's Notion importer. It covers every block type, color and special case.

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

## Inline styles

Plain, **bold**, *italic*, <u>underline</u>, ~~strike~~, `inline code`, [a link](https://example.com), **_bold italic_**, **bold with** `code` and inline math $E = mc^2$ in one paragraph.

First line of a paragraph\
second line after a hard line break.

&nbsp;

The empty paragraph above is intentional.

## Text colors

<span data-color="gray">gray</span> <span data-color="brown">brown</span> <span data-color="orange">orange</span> <span data-color="yellow">yellow</span> <span data-color="green">green</span> <span data-color="blue">blue</span> <span data-color="purple">purple</span> <span data-color="pink">pink</span> <span data-color="red">red</span>

## Highlights

<span data-bg="gray">gray</span> <span data-bg="brown">brown</span> <span data-bg="orange">orange</span> <span data-bg="yellow">yellow</span> <span data-bg="green">green</span> <span data-bg="blue">blue</span> <span data-bg="purple">purple</span> <span data-bg="pink">pink</span> <span data-bg="red">red</span>

Mixed: **<span data-color="red">bold red</span>** and <u><span data-bg="yellow">underlined on yellow</span></u>.

## Block colors

A paragraph with blue text.<!-- color=blue -->

A paragraph with a yellow background.<!-- bg=yellow -->

### A heading with a purple background<!-- bg=purple -->

- A red list item<!-- color=red -->

## Lists

- Bullet one
- Bullet two
  - Nested bullet
    - Third level bullet
- Bullet three

1. Number one
2. Number two
   1. Nested number
      1. Third level number
3. Number three

- [ ] Unchecked to-do
- [x] Checked to-do
  - [ ] Nested to-do
    - [x] Third level to-do

## Toggles

<details>
<summary>A toggle</summary>

Hidden paragraph inside the toggle.

- A bullet inside the toggle

</details>

<details data-heading="1">
<summary>Toggle heading 1</summary>

Content under toggle heading 1.

</details>

<details data-heading="2">
<summary>Toggle heading 2</summary>

Content under toggle heading 2.

</details>

<details data-heading="3">
<summary>Toggle heading 3</summary>

Content under toggle heading 3.

</details>

## Quote and callouts

> A plain quote.

> A quote with a green background<!-- bg=green -->
>
> A child paragraph inside the quote.

> [!callout] 💡
> A default callout
>
> - A bullet inside the callout

> [!callout:orange_bg] 🚧
> An orange callout with a custom icon

---

## Code

```typescript
export function greet(name: string): string {
  return `Hello, ${name}`
}
```

```python
def greet(name):
    return f"Hello, {name}"
```

## Equation

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

## Tables

| Name  | Role     | Score |
| ----- | -------- | ----- |
| Ada   | Engineer | 10    |
| Grace | Admiral  | 9     |

| Fruit  | Color  | Price           |
| ------ | ------ | --------------- |
| Apple  | Red    | 1.20            |
| Banana | Yellow | 0.50<br>on sale |

## Table of contents

<nav data-toc></nav>

## Media

*Image from Notion: fixture-image.png*

![An external image](https://www.notion.so/images/page-cover/gradients_2.png)

*File from Notion: fixture-report.pdf*

## Columns

<div data-columns>

<div data-column>

Left column, half width.

- A list in the left column

</div>

<div data-column>

Right column, half width.

</div>

</div>

<div data-columns>

<div data-column data-width="0.6">

Narrow column.

</div>

<div data-column data-width="1.5">

<details>
<summary>Toggle inside a column</summary>

- List inside a toggle inside a column
  - Nested deeper

</details>

</div>

<div data-column data-width="0.9">

Third column.

</div>

</div>

## Bookmark and embed

<https://www.wikipedia.org>

<https://www.youtube.com/watch?v=aqz-KE-bpKQ>

## Synced block

This text lives in a synced block.

## Links and mentions

A page mention: [Grandchild page](https://www.notion.so/4007c9e82e0e81e79ed6d9a0bd0123a7).

A plain link to a sub-page: [go to the child page](https://app.notion.com/p/4007c9e82e0e81f7b102df32904f66ba).

A mention of a database row: [The Left Hand of Darkness](https://www.notion.so/4007c9e82e0e814c960cdf7fcf4b6a9e).

A date mention: @October 22, 2026 and a date range: @November 1, 2026 → November 3, 2026.

A person mention: @Ada Lovelace.

## Sub-pages and database

[Child page](https://www.notion.so/4007c9e82e0e81f7b102df32904f66ba)

[Q\&A: plans / ideas?](https://www.notion.so/4007c9e82e0e8127999ee63ec39055a2)

[Same name](https://www.notion.so/4007c9e82e0e81c983d1d6f04440ece4)

[Same name](https://www.notion.so/4007c9e82e0e819d9747ccfbcf815c24)

[Reading list](https://www.notion.so/9a60be708a6d4a328b6fffd32be620c2)
````

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/shared/notion/records.test.ts && pnpm exec electron-vite build && pnpm exec playwright test e2e/import.spec.ts -g pasting`
Expected: FAIL. The unit test cannot find `./paste`; the end-to-end test never sees the pasted callout.

- [ ] **Step 3: Write the implementation**

Apply this change to `src/renderer/src/components/PageEditor.tsx`:

```diff
@@ -17,6 +17,7 @@ import { createLanguageResolver, withEditorLanguages } from '../editor/codeLangu
 import type { AppBlock, AppPartialBlock } from '../editor/schema'
 import { resolveAssetUrl } from '../lib/assets'
 import { usePageLink } from '../lib/pageLink'
+import { prepareNotionPaste } from '../editor/notionPaste'
 import { registerFlusher, useApp } from '../store'
 
 const SAVE_DELAY_MS = 500
@@ -213,6 +214,17 @@ export function PageEditor({
       pageLink={pageLink}
       lastColor={lastColor}
       onPickColor={(picked) => void useApp.getState().updateSettings({ lastColor: picked })}
+      pasteNotion={async (clipboard) => {
+        const { blocks, uploads } = await prepareNotionPaste(clipboard)
+        if (uploads > 0) {
+          useApp
+            .getState()
+            .showMessage(
+              "Images and files uploaded to Notion can't be pasted. Import the page to bring them over."
+            )
+        }
+        return withEditorLanguages(blocks, editorLanguage)
+      }}
     />
   )
 }
```

Apply this change to `src/renderer/src/editor/Editor.tsx`:

```diff
@@ -24,6 +24,7 @@ import {
 import { locales as multiColumnLocales, multiColumnDropCursor } from '@blocknote/xl-multi-column'
 import { createContext, useContext, useEffect } from 'react'
 import type { Block } from '@shared/core/blocks'
+import { readNotionClipboard, type NotionClipboard } from '@shared/notion/paste'
 import { ATTACH_FILES_EVENT, insertAtCursor } from './attachFiles'
 import { AppColorStyleButton } from './ColorButton'
 import { ColorPickContext, type PickedColor } from './colors'
@@ -52,6 +53,8 @@ export type EditorProps = {
   /** Applied by Cmd+Shift+H. */
   lastColor?: PickedColor
   onPickColor?(picked: PickedColor): void
+  /** Blocks for content copied from Notion; other pastes use the editor's own handling. */
+  pasteNotion?(clipboard: NotionClipboard): Promise<Block[]>
 }
 
 const DEFAULT_COLOR: PickedColor = { kind: 'background', color: 'yellow' }
@@ -142,6 +145,12 @@ export function Editor(props: EditorProps): React.JSX.Element {
     extensions: [syntaxHighlighter],
     uploadFile: (file) => props.uploadFile(file),
     resolveFileUrl: (url) => props.resolveFileUrl(url),
+    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
+      const notion = event.clipboardData && readNotionClipboard(event.clipboardData)
+      if (!notion || !props.pasteNotion) return defaultPasteHandler()
+      void props.pasteNotion(notion).then((blocks) => insertAtCursor(editor, blocks))
+      return true
+    },
     links: {
       isValidLink,
       onClick: (event) => {
```

Create `src/renderer/src/editor/notionPaste.ts`:

```ts
import type { Block } from '@shared/core/blocks'
import { pageLinkHref } from '@shared/core/links'
import { mapNotionPaste, notionPageIds, type NotionClipboard } from '@shared/notion/paste'
import type { MapContext } from '@shared/notion/types'

const api = window.api

export interface PastedNotion {
  blocks: Block[]
  /** Images and files uploaded to Notion, which a paste cannot bring over. */
  uploads: number
}

/**
 * Turns a Notion copy into blocks: links to pages imported earlier point at them, and web
 * images are downloaded into attachments/.
 */
export async function prepareNotionPaste(clipboard: NotionClipboard): Promise<PastedNotion> {
  const ids = notionPageIds(clipboard)
  const imported = ids.length
    ? await api
        .invoke('notion:pages', { notionIds: ids })
        .catch(() => ({}) as Record<string, string>)
    : {}
  let uploads = 0
  const ctx: MapContext = {
    link: (href, pageId) => {
      const notionId =
        pageId?.replace(/-/g, '') ?? /([0-9a-f]{32})(?:[?#]|$)/.exec(href.replace(/-/g, ''))?.[1]
      const page = notionId ? imported[notionId] : undefined
      return page ? pageLinkHref(page) : href
    },
    file: (src) => src,
    issue: (kind) => {
      if (kind === 'missingFile') uploads++
    }
  }
  const blocks = await fetchImages(mapNotionPaste(clipboard, ctx))
  return { blocks, uploads }
}

async function fetchImages(blocks: Block[]): Promise<Block[]> {
  return Promise.all(
    blocks.map(async (block): Promise<Block> => {
      const children = await fetchImages(block.children)
      if (block.type !== 'image' || !/^https?:/i.test(block.props.url)) {
        return { ...block, children } as Block
      }
      try {
        const url = await api.invoke('attachment:fetch', { url: block.props.url })
        return { ...block, props: { ...block.props, url }, children }
      } catch {
        // Keep a link to it rather than an image the app is not allowed to load.
        const text = block.props.caption || block.props.url
        return {
          type: 'paragraph',
          props: {},
          content: [
            { type: 'link', href: block.props.url, content: [{ type: 'text', text, styles: {} }] }
          ],
          children
        }
      }
    })
  )
}
```

Create `src/shared/notion/paste.ts`:

```ts
import { fromHtml } from 'hast-util-from-html'
import type { Block } from '../core/blocks'
import { attr, findAll, textOf } from './hast'
import { mapNotionFragment } from './html'
import { mapNotionRecords, NOTION_RECORDS_TYPE, type PasteNames } from './records'
import type { MapContext } from './types'

export { NOTION_RECORDS_TYPE }

export interface NotionClipboard {
  records?: string
  html?: string
}

/** Notion's content on a clipboard, or null when it was copied from somewhere else. */
export function readNotionClipboard(
  data: Pick<DataTransfer, 'getData' | 'types'>
): NotionClipboard | null {
  const records = data.types.includes(NOTION_RECORDS_TYPE) ? data.getData(NOTION_RECORDS_TYPE) : ''
  const html = data.types.includes('text/html') ? data.getData('text/html') : ''
  if (records) return { records, html }
  if (html.includes('<!-- notionvc:')) return { html }
  return null
}

/** Notion page ids (32 hex) a paste refers to, so they can be matched to imported pages. */
export function notionPageIds(clipboard: NotionClipboard): string[] {
  const text = `${clipboard.records ?? ''}\n${clipboard.html ?? ''}`
  const ids = new Set<string>()
  for (const m of text.matchAll(
    /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/g
  )) {
    ids.add(m[0].replace(/-/g, ''))
  }
  return [...ids]
}

export function mapNotionPaste(clipboard: NotionClipboard, ctx: MapContext): Block[] {
  const tree = fromHtml(clipboard.html ?? '', { fragment: true })
  const names: PasteNames = { pages: new Map(), text: textOf(tree), blocks: [] }
  for (const a of findAll(tree, (el) => el.tagName === 'a')) {
    const id = /([0-9a-f]{32})(?:[?#]|$)/.exec(attr(a, 'href') ?? '')?.[1]
    if (id) names.pages.set(id, textOf(a).trim())
  }
  const quiet: MapContext = { ...ctx, issue: () => {} }
  if (clipboard.records) {
    names.blocks = mapNotionFragment(tree, quiet)
    const blocks = mapNotionRecords(clipboard.records, ctx, names)
    if (blocks) return blocks
  }
  return mapNotionFragment(tree, ctx)
}
```

Create `src/shared/notion/records.ts`:

```ts
import type { Block, BlockColors, Inline, StyledText, Styles } from '../core/blocks'
import { DEFAULT_CALLOUT_ICON } from '../core/blocks'
import { normalizeInline } from '../core/normalize'
import { inlineText } from '../core/text'
import { notionColor } from './colors'
import type { MapContext } from './types'

// Notion's private clipboard format (`text/_notion-blocks-v3-production`): the copied blocks'
// records, each with its type, rich text, format and child ids.

export const NOTION_RECORDS_TYPE = 'text/_notion-blocks-v3-production'

type RichText = [string, Mark[]?][]
type Mark = [string, ...unknown[]]

interface BlockRecord {
  id: string
  type: string
  properties?: Record<string, RichText | undefined>
  format?: Record<string, unknown>
  content?: string[]
}

export interface PasteNames {
  /** Notion page id (32 hex) -> its title, from the `text/html` copy. */
  pages: Map<string, string>
  /** Text of the `text/html` copy, to recover person names. */
  text: string
  /** The `text/html` copy mapped to blocks, for content the records leave out. */
  blocks: Block[]
}

/** The blocks a Notion copy holds, in order; null when the data is not Notion's format. */
export function mapNotionRecords(json: string, ctx: MapContext, names: PasteNames): Block[] | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  const list = (data as { blocks?: unknown }).blocks
  if (!Array.isArray(list)) return null
  const records = new Map<string, BlockRecord>()
  const top: string[] = []
  for (const item of list as {
    blockId?: string
    blockSubtree?: { block?: Record<string, unknown> }
  }[]) {
    if (typeof item.blockId !== 'string') continue
    top.push(item.blockId)
    for (const [id, wrapped] of Object.entries(item.blockSubtree?.block ?? {})) {
      const value = unwrap(wrapped)
      if (value) records.set(id, { ...value, id })
    }
  }
  return new RecordMapper(records, ctx, names).blocks(top)
}

function unwrap(wrapped: unknown): Omit<BlockRecord, 'id'> | null {
  let value = (wrapped as { value?: unknown })?.value
  // Newer record maps nest the record one level deeper.
  if (value && typeof value === 'object' && !('type' in value) && 'value' in value) {
    value = (value as { value: unknown }).value
  }
  return value && typeof value === 'object' && 'type' in value
    ? (value as Omit<BlockRecord, 'id'>)
    : null
}

class RecordMapper {
  constructor(
    private readonly records: Map<string, BlockRecord>,
    private readonly ctx: MapContext,
    private readonly names: PasteNames
  ) {}

  blocks(ids: string[]): Block[] {
    const out: Block[] = []
    for (const [i, id] of ids.entries()) {
      const record = this.records.get(id)
      if (record?.type === 'transclusion_container' && !this.hasContent(record)) {
        out.push(...this.syncedFromHtml(this.records.get(ids[i - 1]), this.records.get(ids[i + 1])))
        continue
      }
      out.push(...(record ? this.block(record) : this.pageReference(id)))
    }
    return out
  }

  private hasContent(r: BlockRecord): boolean {
    return (r.content ?? []).every((id) => this.records.has(id))
  }

  /**
   * A copied synced block carries only its container; its content is in the `text/html` copy,
   * between the blocks around it.
   */
  private syncedFromHtml(before?: BlockRecord, after?: BlockRecord): Block[] {
    const html = this.names.blocks
    const own = (b: Block): string =>
      'content' in b && Array.isArray(b.content) ? inlineText(b.content as Inline[]).trim() : ''
    const textOf = (r?: BlockRecord): string | null =>
      r ? inlineText(this.text(r)).trim() || null : null
    const prev = textOf(before)
    const next = textOf(after)
    const start = prev === null ? 0 : html.findIndex((b) => own(b) === prev) + 1
    const end =
      next === null ? html.length : html.findIndex((b, i) => i >= start && own(b) === next)
    if (start <= 0 && prev !== null) return this.lostSynced()
    if (end < start) return this.lostSynced()
    return html.slice(start, end)
  }

  private lostSynced(): Block[] {
    this.ctx.issue('skipped', 'Synced block (copy it from the original block)')
    return []
  }

  private children(r: BlockRecord): Block[] {
    return this.blocks(r.content ?? [])
  }

  private text(r: BlockRecord, key = 'title'): Inline[] {
    return this.richText(r.properties?.[key])
  }

  private plain(r: BlockRecord, key: string): string {
    return (r.properties?.[key] ?? []).map((seg) => seg[0]).join('')
  }

  private colors(r: BlockRecord): BlockColors {
    return notionColor(r.format?.block_color as string | undefined)
  }

  private block(r: BlockRecord): Block[] {
    const colors = this.colors(r)
    const children = (): Block[] => this.children(r)
    switch (r.type) {
      case 'text':
        return [{ type: 'paragraph', props: colors, content: this.text(r), children: children() }]
      case 'header':
      case 'sub_header':
      case 'sub_sub_header':
      case 'header_4': {
        const level = { header: 1, sub_header: 2, sub_sub_header: 3, header_4: 4 }[r.type]
        const toggle = r.format?.toggleable === true
        return [
          {
            type: 'heading',
            props: { level, ...colors, ...(toggle ? { isToggleable: true } : {}) },
            content: this.text(r),
            children: children()
          }
        ]
      }
      case 'bulleted_list':
        return [
          { type: 'bulletListItem', props: colors, content: this.text(r), children: children() }
        ]
      case 'numbered_list':
        return [
          { type: 'numberedListItem', props: colors, content: this.text(r), children: children() }
        ]
      case 'to_do':
        return [
          {
            type: 'checkListItem',
            props: { checked: this.plain(r, 'checked') === 'Yes', ...colors },
            content: this.text(r),
            children: children()
          }
        ]
      case 'toggle':
        return [
          { type: 'toggleListItem', props: colors, content: this.text(r), children: children() }
        ]
      case 'quote':
        return [{ type: 'quote', props: colors, content: this.text(r), children: children() }]
      case 'callout':
        return [this.callout(r, colors)]
      case 'divider':
        return [{ type: 'divider', props: {}, children: [] }]
      case 'code': {
        const text = this.plain(r, 'title')
        const language = this.plain(r, 'language').toLowerCase().replace(/ /g, '') || 'text'
        return [
          {
            type: 'codeBlock',
            props: { language: language === 'plaintext' ? 'text' : language },
            content: text ? [{ type: 'text', text, styles: {} }] : [],
            children: []
          }
        ]
      }
      case 'equation':
        return [{ type: 'math', props: { latex: this.plain(r, 'title') }, children: [] }]
      case 'table':
        return [this.table(r)]
      case 'column_list':
        return [{ type: 'columnList', props: {}, children: this.columns(r) }]
      case 'column':
        return children()
      case 'image':
      case 'video':
      case 'audio':
      case 'file':
      case 'pdf':
        return [this.media(r)]
      case 'bookmark':
        return [this.linkParagraph(this.plain(r, 'link'), this.plain(r, 'title'))]
      case 'embed':
      case 'figma':
      case 'tweet':
      case 'maps':
      case 'codepen':
      case 'gist':
        return [this.linkParagraph(this.plain(r, 'source'), '')]
      case 'table_of_contents':
        return [{ type: 'toc', props: {}, children: [] }]
      case 'transclusion_container':
        return children()
      case 'page':
      case 'collection_view_page':
      case 'collection_view':
        return this.pageReference(r.id, this.plain(r, 'title'))
      case 'alias': {
        const target = (r.format?.alias_pointer as { id?: string } | undefined)?.id
        return target ? this.pageReference(target) : []
      }
      default: {
        const text = this.text(r)
        if (text.length === 0 && (r.content ?? []).length === 0) {
          this.ctx.issue('skipped', r.type)
          return []
        }
        this.ctx.issue('unknown', r.type)
        return [{ type: 'paragraph', props: {}, content: text, children: children() }]
      }
    }
  }

  private callout(r: BlockRecord, colors: BlockColors): Block {
    const icon = typeof r.format?.page_icon === 'string' ? r.format.page_icon : DEFAULT_CALLOUT_ICON
    let content = this.text(r)
    let kids = this.children(r)
    // Newer callouts keep their text in a first child paragraph.
    const lead = kids[0]
    if (
      content.length === 0 &&
      lead?.type === 'paragraph' &&
      Object.keys(lead.props).length === 0
    ) {
      content = lead.content
      kids = [...lead.children, ...kids.slice(1)]
    }
    const background =
      colors.backgroundColor || colors.textColor ? colors : { backgroundColor: 'gray' }
    return { type: 'callout', props: { icon, ...background }, content, children: kids }
  }

  private columns(r: BlockRecord): Block[] {
    const columns = (r.content ?? []).map((id) => this.records.get(id)).filter((c) => !!c)
    return columns.map((c) => {
      const ratio = Number(c.format?.column_ratio)
      const width = ratio > 0 ? Math.round(ratio * columns.length * 1000) / 1000 : 1
      return { type: 'column', props: { width }, children: this.children(c) }
    })
  }

  private table(r: BlockRecord): Block {
    const order = (r.format?.table_block_column_order as string[] | undefined) ?? []
    const rows = (r.content ?? [])
      .map((id) => this.records.get(id))
      .filter((row): row is BlockRecord => row?.type === 'table_row')
    if (r.format?.table_block_row_header === true) {
      this.ctx.issue('table', 'Header column (kept as a normal column)')
    }
    return {
      type: 'table',
      props: {},
      content: {
        type: 'tableContent',
        rows: rows.map((row) => ({ cells: order.map((col) => this.text(row, col)) }))
      },
      children: []
    }
  }

  private media(r: BlockRecord): Block {
    const source = this.plain(r, 'source')
    const caption = this.plain(r, 'caption')
    const name = this.plain(r, 'title') || source.split('/').pop() || 'file'
    if (!/^https?:/i.test(source)) {
      // Uploaded files arrive as `attachment:<id>:<name>`; Notion gives no address to fetch.
      const label = r.type === 'image' ? 'Image' : 'File'
      this.ctx.issue('missingFile', name)
      return {
        type: 'paragraph',
        props: {},
        content: [
          { type: 'text', text: `${label} from Notion: ${name}`, styles: { italic: true } }
        ],
        children: []
      }
    }
    const url = this.ctx.file(source)
    if (r.type === 'image') return { type: 'image', props: { url, caption }, children: [] }
    if (r.type === 'video' || r.type === 'audio') {
      return { type: r.type, props: { url, caption }, children: [] }
    }
    return this.linkParagraph(source, name)
  }

  private linkParagraph(href: string, text: string): Block {
    const label: StyledText = { type: 'text', text: text || href, styles: {} }
    return {
      type: 'paragraph',
      props: {},
      content: href ? [{ type: 'link', href: this.ctx.link(href), content: [label] }] : [label],
      children: []
    }
  }

  private pageReference(id: string, title?: string): Block[] {
    const notionId = id.replace(/-/g, '')
    const href = this.ctx.link(`https://www.notion.so/${notionId}`, id)
    const name = title || this.names.pages.get(notionId) || 'Untitled'
    if (href.startsWith('nobsidian://page/'))
      return [{ type: 'pageLink', props: { href }, children: [] }]
    return [this.linkParagraph(href, name)]
  }

  // ---------- rich text ----------

  private richText(rich: RichText | undefined): Inline[] {
    if (!rich) return []
    const out: Inline[] = []
    const people = this.personNames(rich)
    for (const [text, marks = []] of rich) {
      const styles: Styles = {}
      let href: string | null = null
      let replaced: Inline | null = null
      for (const [mark, arg] of marks) {
        switch (mark) {
          case 'b':
            styles.bold = true
            break
          case 'i':
            styles.italic = true
            break
          case '_':
            styles.underline = true
            break
          case 's':
            styles.strike = true
            break
          case 'c':
            styles.code = true
            break
          case 'h':
            Object.assign(styles, notionColor(arg as string))
            break
          case 'a':
            href = this.ctx.link(String(arg))
            break
          case 'e':
            replaced = { type: 'inlineMath', props: { latex: String(arg) } }
            break
          case 'p': {
            const id = String(arg)
            const notionId = id.replace(/-/g, '')
            href = this.ctx.link(`https://www.notion.so/${notionId}`, id)
            replaced = this.styled(this.names.pages.get(notionId) ?? 'Untitled', styles)
            break
          }
          case 'u':
            replaced = this.styled(`@${people.shift() ?? 'Someone'}`, styles)
            break
          case 'd':
            replaced = this.styled(`@${formatDate(arg as NotionDate)}`, styles)
            break
        }
      }
      const item = replaced ?? this.styled(text, styles)
      if (href && item.type === 'text') out.push({ type: 'link', href, content: [item] })
      else out.push(item)
    }
    return normalizeInline(out)
  }

  private styled(text: string, styles: Styles): StyledText {
    return { type: 'text', text, styles: { ...styles } }
  }

  /**
   * Notion's records name people only by id; the `text/html` copy has their names. The rich
   * text around each mention is matched against it to find them.
   */
  private personNames(rich: RichText): string[] {
    if (!rich.some(([, marks = []]) => marks.some(([m]) => m === 'u'))) return []
    const pattern = rich
      .map(([text, marks = []]) => {
        if (marks.some(([m]) => m === 'u')) return '@(.+?)'
        if (marks.some(([m]) => m === 'p' || m === 'd' || m === 'e')) return '.*?'
        return escapeRegExp(text)
      })
      .join('')
    const m = new RegExp(pattern).exec(this.names.text)
    return m ? m.slice(1) : []
  }
}

interface NotionDate {
  start_date?: string
  end_date?: string
  start_time?: string
  end_time?: string
}

function formatDate(date: NotionDate | undefined): string {
  const one = (day?: string, time?: string): string => {
    if (!day) return ''
    const d = new Date(`${day}T00:00:00Z`)
    const text = d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    })
    return time ? `${text} ${time}` : text
  }
  const start = one(date?.start_date, date?.start_time)
  const end = one(date?.end_date, date?.end_time)
  return end ? `${start} → ${end}` : start
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: 234 unit tests and 51 end-to-end tests pass.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add e2e/import.spec.ts src/renderer/src/components/PageEditor.tsx src/renderer/src/editor/Editor.tsx src/renderer/src/editor/notionPaste.ts src/shared/notion/paste.ts src/shared/notion/records.test.ts src/shared/notion/records.ts tests/fixtures/notion-clipboard/expected.md
git commit -m "Keep formatting when pasting from Notion"
```


---

### Task 8: Notion's look for links, inline code and dividers

Imported pages showed browser-blue links, plain inline code and a dark divider next to Notion's originals.
These take Notion's own values (from the CSS in its export): links in the text color with an underline, red inline code on a light background, and a faint divider, in both themes.

**Files:**
- Modify: `src/renderer/src/editor/editor.css`
- Test: `e2e/look.spec.ts`

**Interfaces:**
- Consumes: the editor CSS variables from plan 1.
- Produces: CSS variables `--nb-link-underline`, `--nb-inline-code`, `--nb-inline-code-bg`, `--nb-divider`.

- [ ] **Step 1: Write the failing tests**

Create `e2e/look.spec.ts`:

```ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor } from './helpers'

test('links, inline code and dividers look like Notion’s', async ({ nb }) => {
  await writeFile(
    join(nb.workspace, 'Look.md'),
    'A [link](https://example.com) and `code`.\n\n---\n'
  )
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Look').click()
  const body = page.locator(editor)
  const text = await body
    .locator('p')
    .first()
    .evaluate((el) => getComputedStyle(el).color)
  const link = body.getByRole('link', { name: 'link' })
  await expect(link).toHaveCSS('color', text)
  await expect(link).toHaveCSS('text-decoration-line', 'underline')
  await expect(body.locator('code')).toHaveCSS('color', 'rgb(235, 87, 87)')
  await expect(body.locator('hr')).toHaveCSS('border-top-color', 'rgba(55, 53, 47, 0.16)')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec electron-vite build && pnpm exec playwright test e2e/look.spec.ts`
Expected: FAIL with the link's color `rgb(0, 0, 238)` instead of the text color.

- [ ] **Step 3: Write the implementation**

Apply this change to `src/renderer/src/editor/editor.css`:

```diff
@@ -168,11 +168,38 @@
   --nb-code-bg: #f7f6f3;
   --nb-table-border: #e9e9e7;
   --nb-muted: rgba(55, 53, 47, 0.45);
+  --nb-link-underline: rgba(55, 53, 47, 0.4);
+  --nb-inline-code: #eb5757;
+  --nb-inline-code-bg: rgba(135, 131, 120, 0.15);
+  --nb-divider: rgba(55, 53, 47, 0.16);
 }
 .bn-root[data-color-scheme='dark'] {
   --nb-code-bg: #202020;
   --nb-table-border: rgba(255, 255, 255, 0.13);
   --nb-muted: rgba(255, 255, 255, 0.28);
+  --nb-link-underline: rgba(255, 255, 255, 0.4);
+  --nb-inline-code: #ff7369;
+  --nb-inline-code-bg: rgba(135, 131, 120, 0.15);
+  --nb-divider: rgba(255, 255, 255, 0.13);
+}
+
+.bn-root .bn-inline-content a {
+  color: inherit;
+  text-decoration: underline;
+  text-decoration-color: var(--nb-link-underline);
+  text-underline-offset: 2px;
+}
+.bn-root .bn-inline-content code {
+  color: var(--nb-inline-code);
+  background: var(--nb-inline-code-bg);
+  border-radius: 4px;
+  padding: 0.2em 0.4em;
+  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
+  font-size: 85%;
+}
+.bn-root [data-content-type='divider'] hr {
+  border: none;
+  border-top: 1px solid var(--nb-divider);
 }
 
 .bn-root [data-content-type='heading'] {
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm typecheck && pnpm lint && pnpm test:e2e`
Expected: 52 end-to-end tests pass.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add e2e/look.spec.ts src/renderer/src/editor/editor.css
git commit -m "Match Notion's look for links, inline code and dividers"
```


---

### Task 9: README and final checks

Describes import and paste in the README, then runs everything, including the new end-to-end tests ten times over and the packaged app.

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a README that explains how to import from Notion.

- [ ] **Step 1: Write the implementation**

Apply this change to `README.md`:

```diff
@@ -14,8 +14,9 @@ Your notes are plain Markdown files in a folder you choose, so they stay yours.
 - Favorites, duplicate, move to, and a table of contents block.
 - Trash with restore, and page history with restore.
 - Edits made in other apps, Finder or a sync folder show up live, without losing yours.
-
-Notion import is coming next.
+- Import from Notion: export your workspace from Notion as HTML (with sub-pages), then drop the zip on the window or use File > Import from Notion.
+  Pages keep their nesting, colors, icons, covers, images and links, and a report lists anything that could not be converted exactly.
+- Paste from Notion keeps the formatting of what you copied.
 
 ## Development
 
```

- [ ] **Step 2: Run the tests and checks**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm test:packaged`
Expected: 234 unit tests, 52 end-to-end tests and 2 packaged-app tests pass.

Run: `pnpm exec electron-vite build && pnpm exec playwright test e2e/import.spec.ts e2e/look.spec.ts --repeat-each=10`
Expected: 60 passed.
Any failure must be root-caused and fixed, not retried.

Then import Dale's real Notion workspace export into a scratch workspace and compare pages side by side with Notion; anything that differs goes into the mapper with a fixture test, and the report should list everything that was not converted exactly.

- [ ] **Step 3: Commit (ask Dale first)**

```bash
git add README.md
git commit -m "Describe Notion import and paste in the README"
```


---

## Known limitations

- Table cell colors and header columns cannot be kept, because GFM tables have neither; they are listed in the report.
- Images and files uploaded to Notion cannot be pasted, because Notion puts only an internal reference on the clipboard; the paste leaves a note naming each one, and importing the page brings them over.
- A pasted synced block's content comes from Notion's HTML copy, which is lossy; importing keeps its formatting.
- Inline databases, breadcrumbs, buttons and uploaded page icons are mapped from Notion's documented export HTML rather than from the fixture; the real workspace import is their check.
- Each import is independent: importing the same export twice gives two copies, and edits in Notion after an import are not synced.
