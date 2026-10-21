# Nobsidian Plan 2: Search, Trash, History and Live Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish version one's everyday features: Cmd+K search with recent pages, a Trash panel with restore, page history with restore, live handling of edits made outside the app, plus Duplicate, Move to, a table of contents block and the Cmd+Shift+H highlight shortcut.

**Architecture:** The main process stays the only owner of the disk.
The `Workspace` service gains a search index (MiniSearch), a history store, a trash module and a reconcile step fed by a chokidar watcher, and keeps all of them current through its existing one-at-a-time queue.
Every page the editor loads carries a revision, so a save based on content that changed underneath it is refused instead of overwriting the outside edit; whatever gets replaced is snapshotted to history first.

**Tech Stack:** As plan 1 (Electron 44, electron-vite 6, React 19, TypeScript 7, BlockNote 0.56, zustand, Vitest 5, Playwright 1.64), plus chokidar 6.0.0 and MiniSearch 7.2.

**Spec:** `docs/superpowers/specs/2026-10-21-nobsidian-design.md` (sections 3 and 5 to 10 changed for this plan).

This is plan 2 of 3.
Plan 3 covers Notion import and paste; its importer maps Notion's table of contents block to the `toc` block added here.

## How this plan was made

Every task below was built and verified in a scratch prototype, then replayed task by task in a fresh clone of `main`, running the task's checks at each step.
In the replay: `pnpm typecheck` and `pnpm lint` are clean after every task, the unit tests grow from 101 to 158, and the end-to-end suite grows from 13 to 26 tests, which passed 260 consecutive runs (`--repeat-each=10`).
So the code blocks are known-good; the TDD steps still run each test red, then green, to prove the wiring in the real repo.

## Global Constraints

- Everything in plan 1's Global Constraints still applies (macOS arm64, Node 24 via `.nvmrc`, pnpm 10, TypeScript aliasing, ESM-only `@blocknote/core`, renderer sandboxing and CSP, GPL-3.0-or-later, Prettier and ESLint clean, explicit return types).
- New runtime dependencies go in `dependencies` (the main process loads them at runtime and electron-builder packages them): `"chokidar": "6.0.0"` (pinned exactly: a complete rewrite released 2026-10-19) and `"minisearch": "^7.2.0"`.
- Only the main process touches the filesystem; the watcher, index, history and trash live there.
- Opening a folder never rewrites note bodies: the only writes outside an edit are adding a missing `id:` line, and creating the page file for a folder that has none.
- The `texts` cache in `Workspace` must always hold what is on disk as far as the app knows; any text read that differs from it is an external change and goes through `applyExternal`.
- Comments are rare and short: only invariants, wire-format constraints, or surprising decisions.
- Never use the em dash character in code, docs or commit messages.
- Never run `git commit` without Dale's explicit permission; never add an agent co-author line.

## Review Focus

Inputs and conditions the spec implies that a person will hit, with the test that pins each one:

1. **Another app saves the open page while you are typing** (an editor, a sync tool, `git pull`): neither version may be lost.
   Pinned by the workspace test "refuses a save from an editor that has not seen the outside edit, unless forced" and the e2e test "an outside edit during typing asks before replacing it, and keeps both" in Tasks 4 and 8.
2. **A sync tool writes a "conflicted copy" carrying the same page id**: both pages must survive with distinct ids, and the original keeps its id, favorite and history.
   Pinned by "gives a sync tool’s conflicted copy a fresh id and keeps the original’s" and "on opening, gives a conflicted copy a fresh id rather than the older original" in Task 4.
3. **Restoring a deleted page whose parent is gone or whose name is taken**: it lands at the top level, renamed with ` (2)`, with its own links and other pages' links to it rewritten.
   Pinned by "restores to the top level when the parent is gone, renaming on conflict and fixing links" in Task 4.
4. **Restoring an old version after the page or the pages it links to were renamed**: links must still resolve.
   Pinned by "restores a version with links that survived renames, keeping title and location" in Task 4.
5. **A file another program is still writing** (a copy from Finder, a sync tool, a large `git checkout`): the app must not add its `id:` line until the file has settled, or the rest of the file would be lost.
   Pinned by "waits until a file another program is writing has settled before adding its id" in Task 4.

---

## File Map

| Path | Responsibility |
|---|---|
| `src/shared/core/text.ts` | Plain text of a page for search, and word-start highlight ranges |
| `src/shared/core/{blocks,parse,serialize,normalize,page}.ts` | The `toc` block; broken frontmatter kept as a raw block |
| `src/main/search/index.ts` | MiniSearch wrapper: ranking (titles first), snippets |
| `src/main/history/store.ts` | Snapshots in `.nobsidian/history/<id>/`: save, list, read, remove, prune |
| `src/main/workspace/trash.ts` | Entries in `.nobsidian/trash/`: add, list, read, purge |
| `src/main/workspace/watcher.ts` | chokidar watcher, batching events for `Workspace.reconcile` |
| `src/main/workspace/workspace.ts` | Revisions, history hooks, search, trash, duplicate, reconcile |
| `src/main/handlers.ts`, `index.ts`, `menu.ts`, `settings.ts` | IPC for the new features, watcher lifecycle, quit checkpoint |
| `src/shared/types.ts`, `src/shared/ipc.ts` | New types and channels |
| `src/renderer/src/components/SearchModal.tsx` | Cmd+K search and the Move to picker |
| `src/renderer/src/components/{TrashPopover,TrashedPageView,ReadOnlyPage,Banner,Modal}.tsx` | Trash panel, trashed page preview, shared dialogs |
| `src/renderer/src/components/HistoryModal.tsx` | Page history with preview and restore |
| `src/renderer/src/components/{PageEditor,PageView}.tsx` | Revision-aware saving, the changed-outside banner |
| `src/renderer/src/editor/{schema,slashItems,ColorButton,colors,Editor}.tsx` | Table of contents block, last-color tracking, Cmd+Shift+H |
| `src/renderer/src/lib/{time,trash,pageLink}.ts` | Version labels and "3 days ago", delete-forever wording, page link lookup |
| `e2e/{helpers,search,trash,history,external,pages}.spec.ts` | End-to-end tests for each feature |

---

### Task 1: Converter: table of contents, plain text, broken frontmatter

Teaches the shared converter the table of contents block (`<nav data-toc></nav>`), adds the plain-text extraction the search index uses, and stops broken frontmatter from being mangled.
Until now, a file whose YAML header does not parse got an `id` header added above it, and the old header then rendered as a divider plus a heading; it is now kept as a raw block, byte for byte, and flagged so the page can say so.

**Files:**
- Create: `src/shared/core/text.ts`
- Modify: `src/shared/core/blocks.ts`, `src/shared/core/normalize.ts`, `src/shared/core/page.ts`, `src/shared/core/parse.ts`, `src/shared/core/serialize.ts`, `src/shared/types.ts`
- Test: `src/shared/core/convert.test.ts`, `src/shared/core/paths.test.ts`, `src/shared/core/text.test.ts`

**Interfaces:**
- Consumes: plan 1's `markdownToBlocks`, `blocksToMarkdown`, `parsePage`, `serializePage` and the `Block` types.
- Produces: `TocBlock` (`{ type: 'toc', props: {}, children: [] }`) in the `Block` union; `blocksText(blocks: Block[]): string`; `inlineText(content: Inline[]): string`; `findRanges(text: string, terms: string[]): TextRange[]` in `src/shared/core/text.ts`; `type TextRange = [number, number]` in `src/shared/types.ts`; `ParsedPage.frontmatterError?: boolean`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `src/shared/core/convert.test.ts`:

```diff
@@ -41,6 +41,7 @@ describe('canonical markdown survives a round trip', () => {
     columns:
       '<div data-columns>\n\n<div data-column>\n\nLeft\n\n</div>\n\n<div data-column data-width="2">\n\nRight\n\n</div>\n\n</div>\n',
     paragraphChildren: 'Parent\n\n<div data-children>\n\nChild\n\n</div>\n',
+    toc: '# Intro\n\n<nav data-toc></nav>\n\n## Part\n',
     raw: '<section>custom</section>\n',
     footnote: 'Text[^1]\n\n[^1]: The note\n'
   }
@@ -67,6 +68,12 @@ describe('markdownToBlocks structure', () => {
     ])
   })
 
+  it('parses a table of contents marker into a toc block', () => {
+    expect(markdownToBlocks('<nav data-toc></nav>\n')).toEqual([
+      { type: 'toc', props: {}, children: [] }
+    ])
+  })
+
   it('parses a callout with colors and children', () => {
     const [callout] = markdownToBlocks('> [!callout:blue_bg] 🚀\n> Lead\n>\n> Child\n')
     expect(callout).toMatchObject({
```

Apply this change to `src/shared/core/paths.test.ts`:

```diff
@@ -45,10 +45,22 @@ describe('page files', () => {
     expect(serializePage(page.meta, page.blocks)).toBe(text)
   })
 
-  it('keeps invalid frontmatter as body text', () => {
+  it('keeps invalid frontmatter as a raw block, flagged, byte for byte', () => {
     const page = parsePage('---\nid: [oops\n---\nBody\n')
     expect(page.meta).toEqual({ extra: {} })
-    expect(page.blocks.length).toBeGreaterThan(0)
+    expect(page.frontmatterError).toBe(true)
+    expect(page.blocks[0]).toEqual({
+      type: 'raw',
+      props: { markdown: '---\nid: [oops\n---' },
+      children: []
+    })
+    // Below the id header the app adds when it first sees the file.
+    const withId = '---\nid: abc\n---\n\n---\ntitle: [oops\n---\n\nBody\n'
+    const again = parsePage(withId)
+    expect(again.meta.id).toBe('abc')
+    expect(again.frontmatterError).toBe(true)
+    expect(serializePage(again.meta, again.blocks)).toBe(withId)
+    expect(parsePage('---\nid: a\n---\n\nBody\n').frontmatterError).toBeUndefined()
   })
 
   it('reads files saved with Windows line endings', () => {
```

Create `src/shared/core/text.test.ts`:

````ts
import { describe, expect, it } from 'vitest'
import { markdownToBlocks } from './parse'
import { blocksText, findRanges } from './text'

const textOf = (md: string): string => blocksText(markdownToBlocks(md))

describe('blocksText', () => {
  it('keeps the words of every block, one block per line', () => {
    expect(
      textOf(
        [
          '# Plan **bold**',
          '',
          '- one [link](https://x.y)',
          '  - nested',
          '',
          '> [!callout] 💡',
          '> Note',
          '',
          '| a | b |',
          '| - | - |',
          '| 1 | 2 |',
          '',
          '```ts',
          'const x = 1',
          '```',
          '',
          '![A cat](attachments/cat.png)',
          ''
        ].join('\n')
      )
    ).toBe('Plan bold\none link\nnested\nNote\na b 1 2\nconst x = 1\nA cat')
  })

  it('includes toggle children and raw Markdown, and skips empty blocks', () => {
    expect(
      textOf(
        '<details>\n<summary>Open</summary>\n\nHidden\n\n</details>\n\n&nbsp;\n\n<nav data-toc></nav>\n\n<section>raw</section>\n'
      )
    ).toBe('Open\nHidden\n<section>raw</section>')
  })
})

describe('findRanges', () => {
  it('matches only at word starts, ignoring case, and merges overlaps', () => {
    expect(findRanges('Plan the PLANET, explain', ['plan', 'planet'])).toEqual([
      [0, 4],
      [9, 15]
    ])
  })
})
````

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/shared`
Expected: FAIL. `text.test.ts` cannot import `./text`, and "parses a table of contents marker into a toc block" and "keeps invalid frontmatter as a raw block, flagged, byte for byte" fail.

- [ ] **Step 3: Write the implementation**

Apply this change to `src/shared/core/blocks.ts`:

```diff
@@ -98,6 +98,7 @@ export type PageLinkBlock = WithoutContent<'pageLink', { href: string }>
 export type RawBlock = WithoutContent<'raw', { markdown: string }>
 export type ColumnListBlock = WithoutContent<'columnList', Record<string, never>>
 export type ColumnBlock = WithoutContent<'column', { width: number }>
+export type TocBlock = WithoutContent<'toc', Record<string, never>>
 
 export type Block =
   | ParagraphBlock
@@ -120,6 +121,7 @@ export type Block =
   | RawBlock
   | ColumnListBlock
   | ColumnBlock
+  | TocBlock
 
 export type BlockType = Block['type']
 
```

Apply this change to `src/shared/core/normalize.ts`:

```diff
@@ -39,7 +39,8 @@ const KEEP_PROPS: Record<string, string[]> = {
   pageLink: ['href'],
   raw: ['markdown'],
   columnList: [],
-  column: ['width']
+  column: ['width'],
+  toc: []
 }
 
 function normalizeBlock(block: Block): Block {
```

Apply this change to `src/shared/core/page.ts`:

```diff
@@ -17,6 +17,8 @@ export interface PageMeta {
 export interface ParsedPage {
   meta: PageMeta
   blocks: Block[]
+  /** The file starts with a frontmatter block that is not valid YAML; it is kept as a raw block. */
+  frontmatterError?: boolean
 }
 
 const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
@@ -63,7 +65,30 @@ export function metaFromData(data: Record<string, unknown>): PageMeta {
 
 export function parsePage(text: string): ParsedPage {
   const { data, body } = splitFrontmatter(text)
-  return { meta: data ? metaFromData(data) : { extra: {} }, blocks: markdownToBlocks(body) }
+  const meta = data ? metaFromData(data) : { extra: {} }
+  // Broken frontmatter is either the whole header, or sits below the id header the app added.
+  const broken = FRONTMATTER.exec(body)
+  if (broken && !isYamlMap(broken[1])) {
+    const rest = body.slice(broken[0].length).replace(/^\r?\n/, '')
+    return {
+      meta,
+      blocks: [
+        { type: 'raw', props: { markdown: broken[0].replace(/\r?\n$/, '') }, children: [] },
+        ...markdownToBlocks(rest)
+      ],
+      frontmatterError: true
+    }
+  }
+  return { meta, blocks: markdownToBlocks(body) }
+}
+
+function isYamlMap(yaml: string): boolean {
+  try {
+    const data = parseYaml(yaml) ?? {}
+    return typeof data === 'object' && !Array.isArray(data)
+  } catch {
+    return false
+  }
 }
 
 /**
```

Apply this change to `src/shared/core/parse.ts`:

```diff
@@ -24,6 +24,7 @@ export function markdownToBlocks(markdown: string): Block[] {
 const NBSP = ' '
 const DETAILS_OPEN = /^<details(?: data-heading="([1-6])")?>\n<summary>([\s\S]*)<\/summary>$/
 const DIV_OPEN = /^<div data-(columns|column|children)(?: data-width="([0-9.]+)")?>$/
+const TOC = /^<nav data-toc><\/nav>$/
 const CALLOUT_MARKER = /^\[!callout((?::[a-z_]+)*)\][ \t]*([^\n]*)\n?/
 
 function parseFlow(nodes: RootContent[]): Block[] {
@@ -181,6 +182,7 @@ function parseNode(node: RootContent): Block[] {
     case 'table':
       return [parseTable(node)]
     case 'html': {
+      if (TOC.test(node.value.trim())) return [{ type: 'toc', props: {}, children: [] }]
       const media = parseMediaHtml(node.value)
       if (media) return [media]
       const colors = parseBlockColorComment(node.value)
```

Apply this change to `src/shared/core/serialize.ts`:

```diff
@@ -181,6 +181,8 @@ function blockToFlow(block: Block): RootContent[] {
       return [{ type: 'math', value: block.props.latex }, ...childrenContainer(block.children)]
     case 'divider':
       return [{ type: 'thematicBreak' }, ...childrenContainer(block.children)]
+    case 'toc':
+      return [html('<nav data-toc></nav>'), ...childrenContainer(block.children)]
     case 'table':
       return [tableNode(block.content), ...childrenContainer(block.children)]
     case 'image': {
```

Create `src/shared/core/text.ts`:

```ts
import type { Block, Inline, TableCell } from './blocks'
import type { TextRange } from '../types'

/** The readable text of a page body, one block per line, for search. */
export function blocksText(blocks: Block[]): string {
  const lines: string[] = []
  const walk = (list: Block[]): void => {
    for (const block of list) {
      const line = blockLine(block)
      if (line) lines.push(line)
      walk(block.children)
    }
  }
  walk(blocks)
  return lines.join('\n')
}

function blockLine(block: Block): string {
  switch (block.type) {
    case 'table':
      return block.content.rows
        .map((row) => row.cells.map((cell) => inlineText(cellContent(cell))).join(' '))
        .join(' ')
    case 'codeBlock':
      return block.content.map((c) => c.text).join('')
    case 'image':
    case 'video':
    case 'audio':
      return block.props.caption
    case 'file':
      return block.props.name
    case 'math':
      return block.props.latex
    case 'raw':
      return block.props.markdown
    default:
      return 'content' in block && Array.isArray(block.content)
        ? inlineText(block.content as Inline[])
        : ''
  }
}

export function inlineText(content: Inline[]): string {
  return content
    .map((item) => {
      if (item.type === 'text') return item.text
      if (item.type === 'link') return item.content.map((c) => c.text).join('')
      return item.props.latex
    })
    .join('')
}

function cellContent(cell: Inline[] | TableCell): Inline[] {
  return Array.isArray(cell) ? cell : cell.content
}

/** Where words starting with any of `terms` occur in `text`, merged and in order. */
export function findRanges(text: string, terms: string[]): TextRange[] {
  const ranges: TextRange[] = []
  for (const term of terms) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}`, 'giu')
    for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: TextRange[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([...range])
  }
  return merged
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
```

Apply this change to `src/shared/types.ts`:

```diff
@@ -30,3 +30,6 @@ export interface PageMetaPatch {
   coverPosition?: number | null
   fullWidth?: boolean
 }
+
+/** Start (inclusive) and end (exclusive) offsets of a highlighted span. */
+export type TextRange = [number, number]
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: 106 unit tests pass; no type errors; ESLint reports nothing.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add src/shared/core/blocks.ts src/shared/core/convert.test.ts src/shared/core/normalize.ts src/shared/core/page.ts src/shared/core/parse.ts src/shared/core/paths.test.ts src/shared/core/serialize.ts src/shared/core/text.test.ts src/shared/core/text.ts src/shared/types.ts
git commit -m "Add the table of contents block, plain text and broken frontmatter handling"
```


---

### Task 2: Search index

An in-memory MiniSearch index over page titles and text, living in the main process.
Every page whose title matches ranks above every page that matches only in its text; each hit carries highlight ranges for the title and a one-line snippet.

**Files:**
- Create: `src/main/search/index.ts`
- Modify: `src/shared/types.ts`
- Test: `src/main/search/index.test.ts`

**Interfaces:**
- Consumes: `findRanges` and `TextRange` from Task 1.
- Produces: `class SearchIndex` with `set(id: string, title: string, text: string): void`, `setTitle(id: string, title: string): void`, `remove(id: string): void`, `clear(): void`, `search(query: string, limit = 50): SearchHit[]`; `interface SearchHit { id: string; titleRanges: TextRange[]; snippet: { text: string; ranges: TextRange[] } | null }` in `src/shared/types.ts`.

- [ ] **Step 1: Add MiniSearch**

Run: `pnpm add minisearch@^7.2.0`
Expected: `package.json` lists `"minisearch": "^7.2.0"` under `dependencies` (the main process loads it at runtime).

- [ ] **Step 2: Write the failing tests**

Create `src/main/search/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SearchIndex } from './index'

function index(): SearchIndex {
  const ix = new SearchIndex()
  ix.set('a', 'Groceries', 'Buy apples and a project notebook')
  ix.set('b', 'Project plan', 'Milestones for the launch')
  ix.set('c', 'Ideas', 'Random thoughts')
  return ix
}

describe('SearchIndex', () => {
  it('ranks title matches above content matches', () => {
    expect(
      index()
        .search('project')
        .map((h) => h.id)
    ).toEqual(['b', 'a'])
  })

  it('matches word prefixes and tolerates small typos in longer words', () => {
    const ix = index()
    expect(ix.search('proj').map((h) => h.id)).toEqual(['b', 'a'])
    expect(ix.search('milestnes').map((h) => h.id)).toEqual(['b'])
    expect(ix.search('ide').map((h) => h.id)).toEqual(['c'])
  })

  it('requires every word of the query', () => {
    expect(
      index()
        .search('project launch')
        .map((h) => h.id)
    ).toEqual(['b'])
  })

  it('returns highlight ranges for the title and a snippet around the first content match', () => {
    const [hit] = index().search('apples')
    expect(hit).toEqual({
      id: 'a',
      titleRanges: [],
      snippet: { text: 'Buy apples and a project notebook', ranges: [[4, 10]] }
    })
    const [title] = index().search('plan')
    expect(title.titleRanges).toEqual([[8, 12]])
    expect(title.snippet).toBeNull()
  })

  it('trims long lines around the match', () => {
    const ix = new SearchIndex()
    const long = `${'word '.repeat(30)}needle ${'tail '.repeat(40)}`.trim()
    ix.set('x', 'Long', `First line\n${long}\nLast line`)
    const snippet = ix.search('needle')[0].snippet!
    expect(snippet.text.startsWith('…word')).toBe(true)
    expect(snippet.text.endsWith('…')).toBe(true)
    expect(snippet.text.length).toBeLessThanOrEqual(142)
    const [a, b] = snippet.ranges[0]
    expect(snippet.text.slice(a, b)).toBe('needle')
  })

  it('updates titles and text, and forgets removed pages', () => {
    const ix = index()
    ix.setTitle('c', 'Project ideas')
    expect(ix.search('random').map((h) => h.id)).toEqual(['c'])
    expect(ix.search('project')[0].id).toBe('b')
    expect(ix.search('project').map((h) => h.id)).toContain('c')
    ix.set('c', 'Project ideas', 'Different words')
    expect(ix.search('random')).toEqual([])
    ix.remove('b')
    expect(ix.search('milestones')).toEqual([])
    expect(ix.search('   ')).toEqual([])
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm exec vitest run src/main/search`
Expected: FAIL with "Cannot find module './index'".

- [ ] **Step 4: Write the implementation**

Create `src/main/search/index.ts`:

```ts
import MiniSearch from 'minisearch'
import { findRanges } from '../../shared/core/text'
import type { SearchHit } from '../../shared/types'

interface SearchDoc {
  id: string
  title: string
  text: string
}

const SNIPPET_LENGTH = 140
const SNIPPET_LEAD = 40

export class SearchIndex {
  private docs = new Map<string, SearchDoc>()
  private mini = new MiniSearch<SearchDoc>({
    fields: ['title', 'text'],
    searchOptions: {
      boost: { title: 2 },
      prefix: true,
      fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
      combineWith: 'AND'
    }
  })

  set(id: string, title: string, text: string): void {
    const doc = { id, title, text }
    if (this.docs.has(id)) this.mini.replace(doc)
    else this.mini.add(doc)
    this.docs.set(id, doc)
  }

  /** Updates a title without touching indexed text (or before the text is known). */
  setTitle(id: string, title: string): void {
    const current = this.docs.get(id)
    if (current?.title === title) return
    this.set(id, title, current?.text ?? '')
  }

  remove(id: string): void {
    if (!this.docs.delete(id)) return
    this.mini.discard(id)
  }

  clear(): void {
    this.docs.clear()
    this.mini.removeAll()
  }

  search(query: string, limit = 50): SearchHit[] {
    if (query.trim() === '') return []
    const results = this.mini.search(query)
    const ranked = results
      .map((r) => ({ r, inTitle: r.terms.some((t) => r.match[t]?.includes('title')) }))
      .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.r.score - a.r.score)
      .slice(0, limit)
    return ranked.map(({ r }) => {
      const doc = this.docs.get(r.id as string)!
      return {
        id: doc.id,
        titleRanges: findRanges(doc.title, r.terms),
        snippet: snippetFor(doc.text, r.terms)
      }
    })
  }
}

function snippetFor(text: string, terms: string[]): SearchHit['snippet'] {
  const first = findRanges(text, terms)[0]
  if (!first) return null
  const lineStart = text.lastIndexOf('\n', first[0] - 1) + 1
  const lineEndAt = text.indexOf('\n', first[0])
  const lineEnd = lineEndAt === -1 ? text.length : lineEndAt
  let start = lineStart
  if (first[0] - start > SNIPPET_LEAD) {
    start = first[0] - SNIPPET_LEAD
    const space = text.indexOf(' ', start)
    if (space !== -1 && space < first[0]) start = space + 1
  }
  let end = Math.min(lineEnd, start + SNIPPET_LENGTH)
  if (end < lineEnd) {
    const space = text.lastIndexOf(' ', end)
    if (space > first[1]) end = space
  }
  const prefix = start > lineStart ? '…' : ''
  const suffix = end < lineEnd ? '…' : ''
  const body = text.slice(start, end)
  return {
    text: prefix + body + suffix,
    ranges: findRanges(body, terms).map(([a, b]) => [a + prefix.length, b + prefix.length])
  }
}
```

Apply this change to `src/shared/types.ts`:

```diff
@@ -33,3 +33,10 @@ export interface PageMetaPatch {
 
 /** Start (inclusive) and end (exclusive) offsets of a highlighted span. */
 export type TextRange = [number, number]
+
+export interface SearchHit {
+  id: string
+  titleRanges: TextRange[]
+  /** One line of matching content, or null when only the title matched. */
+  snippet: { text: string; ranges: TextRange[] } | null
+}
```

- [ ] **Step 5: Run the tests and checks**

Run: `pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: 112 unit tests pass; no type or lint errors.

- [ ] **Step 6: Commit (ask Dale first)**

```bash
git add package.json pnpm-lock.yaml src/main/search/index.test.ts src/main/search/index.ts src/shared/types.ts
git commit -m "Add the search index"
```


---

### Task 3: History store

Stores page snapshots as `.nobsidian/history/<page-id>/<timestamp>.md` (the exact file text) plus a `<timestamp>.json` sidecar holding the page's path and the id behind each link, so a restore can find linked pages after renames.
A snapshot identical to the newest one is skipped; pruning keeps 30 days in full and the newest snapshot of each older day.

**Files:**
- Create: `src/main/history/store.ts`
- Modify: `src/shared/types.ts`
- Test: `src/main/history/store.test.ts`

**Interfaces:**
- Consumes: `APP_DIR` and `writeFileAtomic` from plan 1.
- Produces: `class HistoryStore(root: string, now?: () => Date)` with `save(pageId, text, meta: SnapshotMeta): Promise<HistoryVersion | null>`, `list(pageId): Promise<HistoryVersion[]>` (newest first), `read(pageId, id): Promise<Snapshot>`, `remove(pageIds: string[]): Promise<void>`, `prune(): Promise<void>`; `interface SnapshotMeta { path: string; links: Record<string, string> }`; `interface Snapshot { text: string; meta: SnapshotMeta }`; `interface HistoryVersion { id: string; at: string }` in `src/shared/types.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/history/store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HistoryStore } from './store'

let root: string
let clock: Date
const meta = { path: 'Page.md', links: {} }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nobsidian-history-'))
  clock = new Date('2026-10-21T10:00:00.000Z')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const store = (): HistoryStore => new HistoryStore(root, () => clock)
const files = (id: string): Promise<string[]> =>
  readdir(join(root, '.nobsidian', 'history', id)).then((f) => f.sort())

describe('HistoryStore', () => {
  it('saves snapshots with a sidecar, newest first, skipping unchanged text', async () => {
    const h = store()
    expect(await h.save('p', 'one', meta)).toEqual({
      id: '2026-10-21T10-00-00-000Z',
      at: '2026-10-21T10:00:00.000Z'
    })
    expect(await h.save('p', 'one', meta)).toBeNull()
    clock = new Date('2026-10-21T10:05:00.000Z')
    await h.save('p', 'two', { path: 'Moved.md', links: { 'Other.md': 'o' } })
    expect((await h.list('p')).map((v) => v.id)).toEqual([
      '2026-10-21T10-05-00-000Z',
      '2026-10-21T10-00-00-000Z'
    ])
    expect(await h.read('p', '2026-10-21T10-05-00-000Z')).toEqual({
      text: 'two',
      meta: { path: 'Moved.md', links: { 'Other.md': 'o' } }
    })
    expect(await files('p')).toEqual([
      '2026-10-21T10-00-00-000Z.json',
      '2026-10-21T10-00-00-000Z.md',
      '2026-10-21T10-05-00-000Z.json',
      '2026-10-21T10-05-00-000Z.md'
    ])
  })

  it('remembers the newest snapshot across restarts', async () => {
    await store().save('p', 'same', meta)
    expect(await store().save('p', 'same', meta)).toBeNull()
  })

  it('never overwrites a snapshot taken in the same millisecond', async () => {
    const h = store()
    await h.save('p', 'a', meta)
    await h.save('p', 'b', meta)
    expect((await h.list('p')).map((v) => v.id)).toEqual([
      '2026-10-21T10-00-00-001Z',
      '2026-10-21T10-00-00-000Z'
    ])
  })

  it('keeps 30 days in full and the newest snapshot of each older day', async () => {
    const h = store()
    const at = (iso: string, text: string): Promise<unknown> => {
      clock = new Date(iso)
      return h.save('p', text, meta)
    }
    await at('2026-09-01T09:00:00.000Z', 'a')
    await at('2026-09-01T11:00:00.000Z', 'b')
    await at('2026-09-02T09:00:00.000Z', 'c')
    await at('2026-10-15T09:00:00.000Z', 'd')
    await at('2026-10-15T10:00:00.000Z', 'e')
    clock = new Date('2026-10-21T12:00:00.000Z')
    await h.prune()
    expect((await h.list('p')).map((v) => v.at)).toEqual([
      '2026-10-15T10:00:00.000Z',
      '2026-10-15T09:00:00.000Z',
      '2026-09-02T09:00:00.000Z',
      '2026-09-01T11:00:00.000Z'
    ])
    expect(await files('p')).toHaveLength(8)
  })

  it('removes the history of deleted pages', async () => {
    const h = store()
    await h.save('p', 'x', meta)
    await h.remove(['p'])
    expect(await h.list('p')).toEqual([])
    expect(await h.save('p', 'x', meta)).not.toBeNull()
  })

  it('rejects version ids that could escape the history folder', async () => {
    await expect(store().read('p', '../../workspace')).rejects.toThrow('Unknown version')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/main/history`
Expected: FAIL with "Cannot find module './store'".

- [ ] **Step 3: Write the implementation**

Create `src/main/history/store.ts`:

```ts
import { mkdir, readFile, readdir, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { HistoryVersion } from '../../shared/types'
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
```

Apply this change to `src/shared/types.ts`:

```diff
@@ -40,3 +40,10 @@ export interface SearchHit {
   /** One line of matching content, or null when only the title matched. */
   snippet: { text: string; ranges: TextRange[] } | null
 }
+
+export interface HistoryVersion {
+  /** Filename-safe timestamp, e.g. 2026-10-21T14-03-22-123Z. */
+  id: string
+  /** ISO time the snapshot was taken. */
+  at: string
+}
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: 118 unit tests pass; no type or lint errors.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add src/main/history/store.test.ts src/main/history/store.ts src/shared/types.ts
git commit -m "Add the page history store"
```


---

### Task 4: Workspace: revisions, history, search, trash, duplicate and live changes

The core of this plan.
The `Workspace` keeps the search index and history current, refuses saves based on content that changed underneath the editor, manages the trash, duplicates pages, and reconciles changes made outside the app, fed by a chokidar watcher.

Rules this task implements (spec sections 8 and 9):

- Every text the app reads that differs from its `texts` cache is an external change: the cache, index, title and icon update, the page's revision goes up, and a `page` event is emitted.
- Before an external change replaces a page's text, that text is snapshotted: always if the app wrote it this session, otherwise at most every 10 minutes.
- The first app write to a page in a session snapshots the text on disk; later writes snapshot at most every 10 minutes; `checkpoint` (leaving, quitting) snapshots what the app wrote; `listHistory` first snapshots what is on disk, so the newest version is always the current one.
- Rescans skip files whose mtime and size did not change; a page keeps its id at its known path (so a conflicted copy is renumbered, and a dropped id line is restored); on first sight, the older of two files sharing an id keeps it.
- An `id:` line is only written once a file has gone `settleMs` (1 s) without changing, so a file another program is still writing is never cut short.
- Trash entries record the page's position, favorite status and the ids behind its links; restore uses them, and leaves links that now point to a newer page with the old name alone.

**Files:**
- Create: `src/main/workspace/trash.ts`, `src/main/workspace/watcher.ts`
- Modify: `src/main/handlers.ts`, `src/main/workspace/state.ts`, `src/main/workspace/workspace.ts`, `src/shared/types.ts`
- Test: `src/main/workspace/external.test.ts`, `src/main/workspace/history.test.ts`, `src/main/workspace/trash.test.ts`, `src/main/workspace/watcher.test.ts`, `src/main/workspace/workspace.test.ts`

**Interfaces:**
- Consumes: `SearchIndex` (Task 2), `HistoryStore` (Task 3), `blocksText` and `ParsedPage.frontmatterError` (Task 1).
- Produces: `Workspace.open(root, { now?: () => Date; settleMs?: number })`, `close(): void`, `onEvent(listener: (e: WorkspaceEvent) => void): () => void` with `type WorkspaceEvent = { type: 'tree' } | { type: 'page'; id: string; revision: number }`;
`indexContent(): Promise<void>`, `maintain(): Promise<void>`, `reconcile(changes: FileChange[]): Promise<void>`, `search(query): Promise<SearchHit[]>`;
`readPage(id): Promise<PageDoc>` (now with `revision: number` and `frontmatterError?: boolean`), `writePage(id, blocks, { revision?: number; force?: boolean }): Promise<WriteResult>`, `keepDraft(id, blocks): Promise<void>`;
`checkpoint(id?): Promise<void>`, `listHistory(id): Promise<HistoryVersion[]>`, `readHistory(id, version): Promise<PageDoc>`, `restoreHistory(id, version): Promise<void>`;
`duplicatePage(id): Promise<PageNode>`, `listTrash(): Promise<TrashItem[]>`, `readTrash(entry): Promise<PageDoc>`, `restoreTrash(entry): Promise<string>` (the restored page's id), `deleteTrash(entry): Promise<void>`;
`watchWorkspace(root, onChanges: (changes: FileChange[]) => void, onError: (err: unknown) => void): WorkspaceWatcher` with `{ ready: Promise<void>; close(): Promise<void> }`;
`type WriteResult`, `interface FileChange`, `interface TrashItem` in `src/shared/types.ts`; `serializeState` and `STATE_FILE` in `state.ts`.

- [ ] **Step 1: Add chokidar**

Run: `pnpm add chokidar@6.0.0 --save-exact`
Expected: `package.json` lists `"chokidar": "6.0.0"` under `dependencies`.
It is pinned exactly because 6.0.0 is a complete rewrite released on 2026-10-19; move off the pin only after checking a newer release against this task's watcher tests.

- [ ] **Step 2: Write the failing tests**

Create `src/main/workspace/external.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Block } from '../../shared/core/blocks'
import { parsePage } from '../../shared/core/page'
import { blocksText } from '../../shared/core/text'
import type { FileChange } from '../../shared/types'
import { Workspace, type WorkspaceEvent } from './workspace'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nobsidian-external-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const read = (rel: string): Promise<string> => readFile(join(root, rel), 'utf8')
const write = (rel: string, body: string): Promise<void> => writeFile(join(root, rel), body)
const text = (t: string): Block => ({
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text: t, styles: {} }],
  children: []
})
const change = (path: string): FileChange => ({ kind: 'change', path })

/** Snapshot bodies of a page, newest first. */
async function bodies(id: string): Promise<string[]> {
  const dir = join(root, '.nobsidian', 'history', id)
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.md'))
  const texts = await Promise.all(
    names
      .sort()
      .reverse()
      .map((n) => readFile(join(dir, n), 'utf8'))
  )
  return texts.map((t) => blocksText(parsePage(t).blocks))
}

async function opened(): Promise<{ ws: Workspace; events: WorkspaceEvent[] }> {
  const ws = await Workspace.open(root, { settleMs: 0 })
  const events: WorkspaceEvent[] = []
  ws.onEvent((e) => events.push(e))
  return { ws, events }
}

async function namedPage(ws: Workspace, title: string): Promise<string> {
  const { id } = await ws.createPage(null)
  await ws.renamePage(id, title)
  return id
}

describe('Edits made outside the app', () => {
  it('ignores the app’s own writes', async () => {
    const { ws, events } = await opened()
    const id = await namedPage(ws, 'Mine')
    await ws.writePage(id, [text('typed')])
    await ws.reconcile([
      change('Mine.md'),
      { kind: 'add', path: 'Mine.md' },
      { kind: 'addDir', path: '.nobsidian' },
      { kind: 'addDir', path: 'attachments' },
      { kind: 'unlink', path: 'Untitled.md' }
    ])
    expect(events).toEqual([])
  })

  it('picks up an outside edit: new revision, search, and title from frontmatter', async () => {
    const { ws, events } = await opened()
    const id = await namedPage(ws, 'Note')
    await write('Note.md', `---\nid: ${id}\ntitle: Better title\n---\n\nFresh words\n`)
    await ws.reconcile([change('Note.md')])
    expect(events).toEqual([{ type: 'page', id, revision: 1 }, { type: 'tree' }])
    expect(ws.tree()[0].title).toBe('Better title')
    expect((await ws.search('fresh')).map((h) => h.id)).toEqual([id])
    const doc = await ws.readPage(id)
    expect(doc).toMatchObject({ revision: 1, blocks: [text('Fresh words')] })
  })

  it('saves what the app wrote to history before an outside edit replaces it', async () => {
    const { ws } = await opened()
    const id = await namedPage(ws, 'Note')
    await ws.writePage(id, [text('my draft')])
    await write('Note.md', `---\nid: ${id}\n---\n\nTheirs\n`)
    await ws.reconcile([change('Note.md')])
    expect((await bodies(id))[0]).toBe('my draft')
  })

  it('keeps text another app wrote before a newer outside edit replaces it, every 10 minutes', async () => {
    let clock = new Date('2026-10-21T10:00:00.000Z')
    await write('Log.md', 'one\n')
    const ws = await Workspace.open(root, { now: () => clock, settleMs: 0 })
    const id = ws.tree()[0].id
    const head = /^---\n[\s\S]*?\n---\n/.exec(await read('Log.md'))![0]
    const edit = async (body: string): Promise<void> => {
      await write('Log.md', `${head}\n${body}\n`)
      await ws.reconcile([change('Log.md')])
    }
    await edit('two')
    clock = new Date('2026-10-21T10:05:00.000Z')
    await edit('three')
    clock = new Date('2026-10-21T10:11:00.000Z')
    await edit('four')
    expect(await bodies(id)).toEqual(['three', 'one'])
  })

  it('refuses a save from an editor that has not seen the outside edit, unless forced', async () => {
    const { ws } = await opened()
    const id = await namedPage(ws, 'Note')
    await ws.writePage(id, [text('v1')], { revision: 0 })
    await write('Note.md', `---\nid: ${id}\n---\n\nTheirs\n`)
    // No watcher event yet: the save itself must notice the file changed.
    expect(await ws.writePage(id, [text('stale')], { revision: 0 })).toEqual({
      ok: false,
      reason: 'conflict'
    })
    expect(await read('Note.md')).toContain('Theirs')
    expect(await ws.writePage(id, [text('mine')], { revision: 0, force: true })).toEqual({
      ok: true,
      revision: 1
    })
    expect(await read('Note.md')).toContain('mine')
    expect((await bodies(id))[0]).toBe('Theirs')
    expect(await ws.writePage(id, [text('next')], { revision: 1 })).toEqual({
      ok: true,
      revision: 1
    })
  })

  it('notices an outside edit when the page is read', async () => {
    const { ws, events } = await opened()
    const id = await namedPage(ws, 'Note')
    await write('Note.md', `---\nid: ${id}\n---\n\nTheirs\n`)
    expect((await ws.readPage(id)).revision).toBe(1)
    expect(events).toEqual([{ type: 'page', id, revision: 1 }])
  })

  it('puts back an id an outside editor dropped', async () => {
    const { ws } = await opened()
    const id = await namedPage(ws, 'Note')
    await write('Note.md', '---\ntags: [a]\n---\nNo id here\n')
    await ws.reconcile([change('Note.md')])
    expect(await read('Note.md')).toBe(`---\ntags: [a]\nid: ${id}\n---\nNo id here\n`)
  })

  it('waits until a file another program is writing has settled before adding its id', async () => {
    await write('Copying.md', 'first half')
    const ws = await Workspace.open(root, { settleMs: 300 })
    expect(ws.tree()).toEqual([])
    expect(await read('Copying.md')).toBe('first half')
    const arrived = new Promise<void>((resolve) =>
      ws.onEvent((e) => e.type === 'tree' && ws.tree().length > 0 && resolve())
    )
    await write('Copying.md', 'first half, second half\n')
    await arrived
    expect(ws.tree()[0].title).toBe('Copying')
    expect(await read('Copying.md')).toMatch(
      /^---\nid: [0-9a-f-]{36}\n---\n\nfirst half, second half\n$/
    )
    ws.close()
  })

  it('keeps a page whose id line was dropped the same page, even through a full rescan', async () => {
    const ws = await Workspace.open(root, { settleMs: 300 })
    const id = await namedPage(ws, 'Note')
    await ws.setFavorite(id, true)
    await write('Note.md', 'Rewritten without frontmatter\n')
    await ws.reconcile([change('Note.md'), { kind: 'add', path: 'Other.md' }])
    expect(ws.tree()[0].id).toBe(id)
    expect(ws.favorites()).toEqual([id])
    const restored = new Promise<void>((resolve) =>
      ws.onEvent((e) => e.type === 'tree' && resolve())
    )
    await restored
    expect(await read('Note.md')).toBe(`---\nid: ${id}\n---\n\nRewritten without frontmatter\n`)
    ws.close()
  })

  it('adds, moves and removes pages changed in Finder, keeping ids and favorites', async () => {
    const { ws, events } = await opened()
    const id = await namedPage(ws, 'Keep')
    await ws.setFavorite(id, true)
    await namedPage(ws, 'Gone')
    await write('Arrived.md', 'Hello from outside\n')
    await mkdir(join(root, 'Folder'))
    await rename(join(root, 'Keep.md'), join(root, 'Folder', 'Moved.md'))
    await unlink(join(root, 'Gone.md'))
    await ws.reconcile([
      { kind: 'add', path: 'Arrived.md' },
      { kind: 'addDir', path: 'Folder' },
      { kind: 'unlink', path: 'Keep.md' },
      { kind: 'add', path: 'Folder/Moved.md' },
      { kind: 'unlink', path: 'Gone.md' }
    ])
    const tree = ws.tree()
    expect(tree.map((n) => n.title)).toEqual(['Arrived', 'Folder'])
    expect(tree[1].children.map((n) => [n.id, n.title])).toEqual([[id, 'Moved']])
    expect(ws.favorites()).toEqual([id])
    expect(await read('Arrived.md')).toMatch(
      /^---\nid: [0-9a-f-]{36}\n---\n\nHello from outside\n$/
    )
    expect((await ws.search('hello')).map((h) => h.id)).toEqual([tree[0].id])
    expect(await ws.search('gone')).toEqual([])
    expect(events.at(-1)).toEqual({ type: 'tree' })
  })

  it('gives a sync tool’s conflicted copy a fresh id and keeps the original’s', async () => {
    const { ws } = await opened()
    const id = await namedPage(ws, 'Plan')
    const body = await read('Plan.md')
    await write('Plan (conflicted copy).md', body)
    await ws.reconcile([{ kind: 'add', path: 'Plan (conflicted copy).md' }])
    const byTitle = Object.fromEntries(ws.tree().map((n) => [n.title, n.id]))
    expect(byTitle['Plan']).toBe(id)
    expect(byTitle['Plan (conflicted copy)']).not.toBe(id)
    expect(await read('Plan (conflicted copy).md')).toContain(
      `id: ${byTitle['Plan (conflicted copy)']}`
    )
  })

  it('on opening, gives a conflicted copy a fresh id rather than the older original', async () => {
    const same = '---\nid: 11111111-1111-4111-8111-111111111111\n---\n\nPlan\n'
    await write('Plan.md', same)
    // The copy sorts first by name but was created later.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await write('Plan (conflicted copy).md', same)
    const { ws } = await opened()
    const byTitle = Object.fromEntries(ws.tree().map((n) => [n.title, n.id]))
    expect(byTitle['Plan']).toBe('11111111-1111-4111-8111-111111111111')
    expect(byTitle['Plan (conflicted copy)']).not.toBe(byTitle['Plan'])
  })

  it('reloads favorites and order synced from another Mac, ignoring its own saves', async () => {
    const { ws, events } = await opened()
    const a = await namedPage(ws, 'A')
    const b = await namedPage(ws, 'B')
    await ws.reconcile([change('.nobsidian/workspace.json')])
    expect(events).toEqual([])
    await write(
      '.nobsidian/workspace.json',
      JSON.stringify({ version: 1, order: { root: [b, a] }, favorites: [a] })
    )
    await ws.reconcile([change('.nobsidian/workspace.json')])
    expect(events).toEqual([{ type: 'tree' }])
    expect(ws.tree().map((n) => n.id)).toEqual([b, a])
    expect(ws.favorites()).toEqual([a])
  })

  it('rescans without rereading files that did not change', async () => {
    const { ws } = await opened()
    const id = await namedPage(ws, 'Locked')
    await ws.reconcile([{ kind: 'add', path: 'Other.md' }])
    await chmod(join(root, 'Locked.md'), 0o000)
    try {
      await write('New.md', 'x\n')
      await ws.reconcile([{ kind: 'add', path: 'New.md' }])
      expect(ws.tree().map((n) => n.id)).toContain(id)
    } finally {
      await chmod(join(root, 'Locked.md'), 0o644)
    }
  })

  it('shows frontmatter that is not valid YAML as text, before and after editing', async () => {
    await write('Broken.md', '---\ntitle: [unclosed\n---\nBody\n')
    const { ws } = await opened()
    const id = ws.tree()[0].id
    const doc = await ws.readPage(id)
    expect(doc.frontmatterError).toBe(true)
    expect(doc.blocks).toEqual([
      { type: 'raw', props: { markdown: '---\ntitle: [unclosed\n---' }, children: [] },
      text('Body')
    ])
    await ws.writePage(id, [...doc.blocks, text('More')])
    expect(await read('Broken.md')).toBe(
      `---\nid: ${id}\n---\n\n---\ntitle: [unclosed\n---\n\nBody\n\nMore\n`
    )
    expect((await ws.readPage(id)).frontmatterError).toBe(true)
  })
})
```

Create `src/main/workspace/history.test.ts`:

```ts
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
```

Create `src/main/workspace/trash.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Block } from '../../shared/core/blocks'
import { pageLinkHref } from '../../shared/core/links'
import { Workspace } from './workspace'

let root: string
let clock: Date

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nobsidian-trash-'))
  clock = new Date('2026-10-21T10:00:00.000Z')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const open = (): Promise<Workspace> => Workspace.open(root, { now: () => clock, settleMs: 0 })
const read = (rel: string): Promise<string> => readFile(join(root, rel), 'utf8')
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

async function page(ws: Workspace, parentId: string | null, title: string): Promise<string> {
  const { id } = await ws.createPage(parentId)
  await ws.renamePage(id, title)
  return id
}

describe('Trash', () => {
  it('lists deleted pages newest first with their parent and sub-page count', async () => {
    const ws = await open()
    const parent = await page(ws, null, 'Parent')
    const a = await page(ws, parent, 'A')
    await page(ws, a, 'A child')
    await ws.updateMeta(a, { icon: '🚀' })
    const b = await page(ws, null, 'B')
    await ws.trashPage(a)
    clock = new Date('2026-10-21T11:00:00.000Z')
    await ws.trashPage(b)
    const items = await ws.listTrash()
    expect(items.map((i) => [i.title, i.parentTitle, i.pageCount, i.deletedAt])).toEqual([
      ['B', null, 1, '2026-10-21T11:00:00.000Z'],
      ['A', 'Parent', 2, '2026-10-21T10:00:00.000Z']
    ])
    expect(items[1].icon).toBe('🚀')
    expect(items[1].pageId).toBe(a)
  })

  it('opens a deleted page read-only with links to live pages resolved', async () => {
    const ws = await open()
    const target = await page(ws, null, 'Target')
    const gone = await page(ws, null, 'Gone')
    await ws.writePage(gone, [text('Remember this'), link(target)])
    await ws.trashPage(gone)
    const [item] = await ws.listTrash()
    const doc = await ws.readTrash(item.entry)
    expect(doc).toMatchObject({
      id: gone,
      title: 'Gone',
      blocks: [text('Remember this'), link(target)]
    })
  })

  it('restores a page with its sub-pages to the original place', async () => {
    const ws = await open()
    const parent = await page(ws, null, 'Parent')
    const a = await page(ws, parent, 'A')
    const child = await page(ws, a, 'Child')
    const other = await page(ws, null, 'Other')
    await ws.writePage(other, [link(child)])
    await ws.trashPage(a)
    const [item] = await ws.listTrash()
    expect(await ws.restoreTrash(item.entry)).toBe(a)
    const parentNode = ws.tree().find((n) => n.id === parent)!
    expect(parentNode.children.map((n) => n.title)).toEqual(['A'])
    expect(parentNode.children[0].children.map((n) => n.id)).toEqual([child])
    expect(await read('Parent/A/Child.md')).toContain(`id: ${child}`)
    expect(await ws.listTrash()).toEqual([])
    expect(await read('Other.md')).toContain('(Parent/A/Child.md "page")')
  })

  it('restores to the top level when the parent is gone, renaming on conflict and fixing links', async () => {
    const ws = await open()
    const parent = await page(ws, null, 'Parent')
    const a = await page(ws, parent, 'Notes')
    const child = await page(ws, a, 'Child')
    await page(ws, null, 'Notes')
    const other = await page(ws, null, 'Other')
    await ws.writePage(other, [link(child)])
    await ws.writePage(child, [link(other)])
    await ws.trashPage(a)
    await ws.trashPage(parent)
    const entry = (await ws.listTrash()).find((i) => i.pageId === a)!.entry
    await ws.restoreTrash(entry)
    const restored = ws.tree().find((n) => n.id === a)!
    expect(restored).toMatchObject({ title: 'Notes', path: 'Notes (2).md' })
    expect(await read('Notes (2).md')).toContain('title: Notes')
    expect(await read('Other.md')).toContain('(Notes%20\\(2\\)/Child.md "page")')
    expect(await read('Notes (2)/Child.md')).toContain('(../Other.md "page")')
    expect(
      ws
        .tree()
        .map((n) => n.id)
        .at(-1)
    ).toBe(a)
  })

  it('puts a restored page back in its old position, and back in Favorites', async () => {
    const ws = await open()
    const a = await page(ws, null, 'A')
    const b = await page(ws, null, 'B')
    const c = await page(ws, null, 'C')
    await ws.setFavorite(b, true)
    await ws.trashPage(b)
    expect(ws.favorites()).toEqual([])
    const [item] = await ws.listTrash()
    await ws.restoreTrash(item.entry)
    expect(ws.tree().map((n) => n.id)).toEqual([a, b, c])
    expect(ws.favorites()).toEqual([b])
  })

  it('leaves links to a newer page with the same name alone', async () => {
    const ws = await open()
    const old = await page(ws, null, 'Ideas')
    await ws.trashPage(old)
    const fresh = await page(ws, null, 'Ideas')
    const other = await page(ws, null, 'Other')
    await ws.writePage(other, [link(fresh)])
    const [item] = await ws.listTrash()
    await ws.restoreTrash(item.entry)
    expect(ws.tree().find((n) => n.id === old)?.path).toBe('Ideas (2).md')
    expect(await read('Other.md')).toContain('[Ideas](Ideas.md "page")')
  })

  it('keeps links from a trashed page to pages renamed while it was in Trash', async () => {
    const ws = await open()
    const a = await page(ws, null, 'A')
    const b = await page(ws, null, 'B')
    await ws.writePage(a, [link(b)])
    await ws.trashPage(a)
    await ws.renamePage(b, 'B2')
    const [item] = await ws.listTrash()
    await ws.restoreTrash(item.entry)
    expect(await read('A.md')).toContain('[B2](B2.md "page")')
  })

  it('restores a page whose id a live page took meanwhile, without touching the live one', async () => {
    const ws = await open()
    const a = await page(ws, null, 'A')
    await ws.writePage(a, [text('trashed copy')])
    await ws.checkpoint(a)
    await ws.trashPage(a)
    // A sync tool brings back a file with the same id under another name.
    await writeFile(join(root, 'Synced.md'), `---\nid: ${a}\n---\n\nlive copy\n`)
    await ws.reconcile([{ kind: 'add', path: 'Synced.md' }])
    const [item] = await ws.listTrash()
    const restoredId = await ws.restoreTrash(item.entry)
    expect(restoredId).not.toBe(a)
    expect(ws.tree().find((n) => n.id === a)?.title).toBe('Synced')
    expect(ws.tree().find((n) => n.id === restoredId)?.title).toBe('A')
    await ws.trashPage(restoredId)
    const [again] = await ws.listTrash()
    await ws.deleteTrash(again.entry)
    expect(await readdir(join(root, '.nobsidian', 'history', a))).not.toEqual([])
  })

  it('cleans up an entry whose page never arrived', async () => {
    const dir = join(root, '.nobsidian', 'trash', '2026-10-21T09-00-00-000Z-x')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'meta.json'),
      JSON.stringify({
        id: 'x',
        title: 'Gone',
        originalPath: 'Gone.md',
        parentId: null,
        deletedAt: '2026-10-21T09:00:00.000Z'
      })
    )
    const ws = await open()
    expect(await ws.listTrash()).toEqual([])
    expect(await readdir(join(root, '.nobsidian', 'trash'))).toEqual([])
  })

  it('deletes forever, removing the history of every page in the entry', async () => {
    const ws = await open()
    const a = await page(ws, null, 'A')
    const child = await page(ws, a, 'Child')
    await ws.writePage(a, [text('one')])
    await ws.writePage(child, [text('two')])
    await ws.checkpoint()
    expect(await readdir(join(root, '.nobsidian', 'history'))).toHaveLength(2)
    await ws.trashPage(a)
    const [item] = await ws.listTrash()
    await ws.deleteTrash(item.entry)
    expect(await ws.listTrash()).toEqual([])
    expect(await readdir(join(root, '.nobsidian', 'history'))).toEqual([])
    expect(await readdir(join(root, '.nobsidian', 'trash'))).toEqual([])
  })

  it('purges entries older than 30 days', async () => {
    const ws = await open()
    await ws.trashPage(await page(ws, null, 'Old'))
    clock = new Date('2026-11-15T10:00:00.000Z')
    await ws.trashPage(await page(ws, null, 'Recent'))
    clock = new Date('2026-11-21T10:00:00.000Z')
    await ws.maintain()
    expect((await ws.listTrash()).map((i) => i.title)).toEqual(['Recent'])
  })

  it('skips trash entries it cannot read and refuses unsafe entry names', async () => {
    await mkdir(join(root, '.nobsidian', 'trash', 'broken'), { recursive: true })
    await writeFile(join(root, '.nobsidian', 'trash', 'broken', 'meta.json'), '{')
    const ws = await open()
    expect(await ws.listTrash()).toEqual([])
    await expect(ws.restoreTrash('../../x')).rejects.toThrow('Unknown trash item')
  })
})

describe('Duplicate', () => {
  it('copies a page and its sub-pages below the original, pointing internal links at the copies', async () => {
    const ws = await open()
    const outside = await page(ws, null, 'Outside')
    const a = await page(ws, null, 'Plan')
    const child = await page(ws, a, 'Step')
    await page(ws, null, 'Last')
    await ws.updateMeta(a, { icon: '🚀' })
    await ws.writePage(a, [text('Body'), link(child), link(outside)])
    await ws.setFavorite(a, true)
    const copy = await ws.duplicatePage(a)
    expect(ws.tree().map((n) => n.title)).toEqual(['Outside', 'Plan', 'Plan (1)', 'Last'])
    expect(copy).toMatchObject({ title: 'Plan (1)', path: 'Plan (1).md', icon: '🚀' })
    const childCopy = copy.children[0]
    expect(childCopy).toMatchObject({ title: 'Step', path: 'Plan (1)/Step.md' })
    expect(childCopy.id).not.toBe(child)
    const doc = await ws.readPage(copy.id)
    expect(doc.blocks).toEqual([text('Body'), link(childCopy.id), link(outside)])
    expect(await read('Plan (1).md')).toContain('[Step](Plan%20\\(1\\)/Step.md "page")')
    expect(ws.favorites()).toEqual([a])
    const hits = await ws.search('body')
    expect(hits.map((h) => h.id).sort()).toEqual([a, copy.id].sort())
  })

  it('names a copy of an untitled page "Untitled (1)"', async () => {
    const ws = await open()
    const p = await ws.createPage(null)
    expect((await ws.duplicatePage(p.id)).title).toBe('Untitled (1)')
  })
})
```

Create `src/main/workspace/watcher.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Block } from '../../shared/core/blocks'
import { isIgnored, watchWorkspace, type WorkspaceWatcher } from './watcher'
import { Workspace, type WorkspaceEvent } from './workspace'

let root: string
let watcher: WorkspaceWatcher | null

beforeEach(async () => {
  // tmpdir() is under /var, a symlink to /private/var, like a workspace reached through a link.
  root = await mkdtemp(join(tmpdir(), 'nobsidian-watch-'))
  watcher = null
})
afterEach(async () => {
  await watcher?.close()
  await rm(root, { recursive: true, force: true })
})

const text = (t: string): Block => ({
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text: t, styles: {} }],
  children: []
})

/** A workspace wired to a real watcher, recording the events it emits. */
async function watched(): Promise<{
  ws: Workspace
  events: WorkspaceEvent[]
  next: (match: (e: WorkspaceEvent) => boolean) => Promise<void>
}> {
  const ws = await Workspace.open(root, { settleMs: 0 })
  const events: WorkspaceEvent[] = []
  const waiters: { match: (e: WorkspaceEvent) => boolean; resolve: () => void }[] = []
  ws.onEvent((e) => {
    events.push(e)
    for (const w of waiters.filter((w) => w.match(e))) {
      waiters.splice(waiters.indexOf(w), 1)
      w.resolve()
    }
  })
  watcher = watchWorkspace(
    root,
    (changes) => void ws.reconcile(changes),
    (err) => {
      throw err
    }
  )
  await watcher.ready
  const next = (match: (e: WorkspaceEvent) => boolean): Promise<void> =>
    new Promise((resolve) => waiters.push({ match, resolve }))
  return { ws, events, next }
}

describe('watchWorkspace', () => {
  it('reports an outside edit to the open workspace', async () => {
    const { ws, next } = await watched()
    const { id, path } = await ws.createPage(null)
    const changed = next((e) => e.type === 'page' && e.id === id)
    await writeFile(join(root, path), `---\nid: ${id}\n---\n\nFrom another editor\n`)
    await changed
    expect((await ws.readPage(id)).blocks).toEqual([text('From another editor')])
  })

  it('stays quiet about the app’s own writes', async () => {
    const { ws, events, next } = await watched()
    const { id } = await ws.createPage(null)
    await ws.writePage(id, [text('typed in the app')])
    await ws.renamePage(id, 'Renamed')
    await ws.setFavorite(id, true)
    // An outside file added afterwards proves earlier events were already processed.
    const marker = next((e) => e.type === 'tree')
    await writeFile(join(root, 'Marker.md'), 'marker\n')
    await marker
    expect(events).toEqual([{ type: 'tree' }])
  })
})

describe('isIgnored', () => {
  it('watches pages and the workspace state, nothing else', () => {
    expect(isIgnored('Notes.md')).toBe(false)
    expect(isIgnored('Projects/Plan.md')).toBe(false)
    expect(isIgnored('Projects')).toBe(false)
    expect(isIgnored('.nobsidian')).toBe(false)
    expect(isIgnored('.nobsidian/workspace.json')).toBe(false)
    expect(isIgnored('.nobsidian/history')).toBe(true)
    expect(isIgnored('.nobsidian/trash/x/Page.md')).toBe(true)
    expect(isIgnored('attachments')).toBe(true)
    expect(isIgnored('attachments/cat.png')).toBe(true)
    expect(isIgnored('.Notes.md.1a2b3c.tmp')).toBe(true)
    expect(isIgnored('Projects/.git/config')).toBe(true)
  })
})
```

Apply this change to `src/main/workspace/workspace.test.ts`:

```diff
@@ -30,7 +30,7 @@ describe('Workspace scanning', () => {
     await writeFile(join(root, 'Projects', 'Website.md'), 'Hello\n')
     await mkdir(join(root, 'Orphan Folder'))
     await writeFile(join(root, 'Orphan Folder', 'Child.md'), '')
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const tree = ws.tree()
     expect(tree.map((n) => n.title)).toEqual(['Orphan Folder', 'Projects'])
     expect(tree[1].children.map((n) => n.path)).toEqual(['Projects/Website.md'])
@@ -47,7 +47,7 @@ describe('Workspace scanning', () => {
     await mkdir(join(root, 'attachments'))
     await writeFile(join(root, 'attachments', 'note.md'), 'not a page')
     await mkdir(join(root, '.nobsidian'))
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     expect(ws.tree()).toEqual([])
   })
 
@@ -55,7 +55,7 @@ describe('Workspace scanning', () => {
     const same = '---\nid: 11111111-1111-1111-1111-111111111111\n---\n'
     await writeFile(join(root, 'A.md'), same)
     await writeFile(join(root, 'B.md'), same)
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const ids = ws.tree().map((n) => n.id)
     expect(new Set(ids).size).toBe(2)
   })
@@ -63,7 +63,7 @@ describe('Workspace scanning', () => {
 
 describe('Workspace page operations', () => {
   it('creates, writes and reads pages', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const a = await ws.createPage(null)
     const b = await ws.createPage(null)
     expect([a.path, b.path]).toEqual(['Untitled.md', 'Untitled (2).md'])
@@ -75,7 +75,7 @@ describe('Workspace page operations', () => {
   })
 
   it('renames a page with its children and rewrites links', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const parent = await ws.createPage(null)
     const child = await ws.createPage(parent.id)
     const other = await ws.createPage(null)
@@ -96,7 +96,7 @@ describe('Workspace page operations', () => {
   })
 
   it('moves a page and keeps its relative links working', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const target = await ws.createPage(null)
     await ws.renamePage(target.id, 'Target')
     const mover = await ws.createPage(null)
@@ -115,31 +115,31 @@ describe('Workspace page operations', () => {
   })
 
   it('never names a root page like the attachments folder', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const p = await ws.createPage(null)
     await ws.renamePage(p.id, 'Attachments')
     expect(ws.tree()[0]).toMatchObject({ title: 'Attachments', path: 'Attachments (2).md' })
   })
 
   it('refuses to move a page into its own descendant', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const a = await ws.createPage(null)
     const b = await ws.createPage(a.id)
     await expect(ws.movePage(a.id, b.id, 0)).rejects.toThrow('inside itself')
   })
 
   it('reorders siblings and persists the order', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const a = await ws.createPage(null)
     const b = await ws.createPage(null)
     await ws.movePage(b.id, null, 0)
     expect(ws.tree().map((n) => n.id)).toEqual([b.id, a.id])
-    const reopened = await Workspace.open(root)
+    const reopened = await Workspace.open(root, { settleMs: 0 })
     expect(reopened.tree().map((n) => n.id)).toEqual([b.id, a.id])
   })
 
   it('trashes a page with its children and keeps links serializable', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const a = await ws.createPage(null)
     await ws.createPage(a.id)
     const keep = await ws.createPage(null)
@@ -162,7 +162,7 @@ describe('Workspace page operations', () => {
   })
 
   it('updates icon, cover and full width in frontmatter', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const p = await ws.createPage(null)
     const cover = await ws.saveAttachment('cover.jpg', new Uint8Array([9]))
     await ws.updateMeta(p.id, { icon: '🚀', cover, coverPosition: 30, fullWidth: true })
@@ -175,7 +175,7 @@ describe('Workspace page operations', () => {
   })
 
   it('serializes concurrent writes', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const p = await ws.createPage(null)
     await Promise.all([
       ws.writePage(p.id, [text('one')]),
@@ -186,7 +186,7 @@ describe('Workspace page operations', () => {
   })
 
   it('refuses asset paths outside the workspace', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     expect(ws.resolveAsset('/../../etc/passwd')).toBe(join(root, 'etc', 'passwd'))
     expect(ws.resolveAsset('/.nobsidian/workspace.json')).toBeNull()
   })
@@ -197,7 +197,7 @@ describe('Workspace keeps existing notes intact', () => {
     await writeFile(join(root, 'Notes.md'), 'important content\n')
     await mkdir(join(root, 'notes'))
     await writeFile(join(root, 'notes', 'Child.md'), 'child\n')
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     expect(await read('Notes.md')).toContain('important content')
     expect(ws.tree()).toHaveLength(1)
     expect(ws.tree()[0].children.map((c) => c.title)).toEqual(['Child'])
@@ -209,7 +209,7 @@ describe('Workspace keeps existing notes intact', () => {
     await writeFile(join(root, 'Plan.md'), body)
     await writeFile(join(root, 'Meta.md'), '---\n# a comment\ntags: [x, y]\n---\nBody *text*\n')
     await writeFile(join(root, 'Bom.md'), '\uFEFF---\nid: abc\ntitle: T\n---\n\nHello\n')
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const plan = await read('Plan.md')
     const front = /^---\nid: [0-9a-f-]{36}\n---\n\n/
     expect(plan).toMatch(front)
@@ -222,7 +222,7 @@ describe('Workspace keeps existing notes intact', () => {
   })
 
   it('reads a page only after queued writes have landed', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const p = await ws.createPage(null)
     const other = await ws.createPage(null)
     void ws.renamePage(other.id, 'Renamed')
@@ -231,7 +231,7 @@ describe('Workspace keeps existing notes intact', () => {
   })
 
   it('keeps image icons working after a move', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const a = await ws.createPage(null)
     await ws.renamePage(a.id, 'A')
     const b = await ws.createPage(null)
@@ -244,7 +244,7 @@ describe('Workspace keeps existing notes intact', () => {
   })
 
   it('renames without reading pages that do not link to the renamed page', async () => {
-    const ws = await Workspace.open(root)
+    const ws = await Workspace.open(root, { settleMs: 0 })
     const p = await ws.createPage(null)
     const other = await ws.createPage(null)
     await ws.writePage(other.id, [text('unrelated')])
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm exec vitest run src/main/workspace`
Expected: FAIL. `watcher.test.ts` cannot import `./watcher`; the history, trash and external tests fail (for example `ws.onEvent is not a function`); `workspace.test.ts` passes.

- [ ] **Step 4: Write the implementation**

`handlers.ts` changes only so `page:write` keeps returning nothing; Task 5 rewires IPC.

Replace the whole of `src/main/handlers.ts` with:

```ts
import { BrowserWindow, dialog, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { TreeSnapshot } from '../shared/ipc'
import type { WorkspaceInfo } from '../shared/types'
import { handle, send } from './ipc'
import type { SettingsStore } from './settings'
import { Workspace } from './workspace/workspace'

export interface AppContext {
  settings: SettingsStore
  workspace: Workspace | null
  window: () => BrowserWindow | null
}

export function workspaceInfo(ws: Workspace): WorkspaceInfo {
  return { root: ws.root, name: basename(ws.root) }
}

export function snapshot(ws: Workspace): TreeSnapshot {
  return { pages: ws.tree(), favorites: ws.favorites() }
}

export async function openWorkspace(ctx: AppContext, root: string): Promise<WorkspaceInfo> {
  ctx.workspace = await Workspace.open(root)
  await ctx.settings.set({ lastWorkspace: root })
  return workspaceInfo(ctx.workspace)
}

export function registerHandlers(ctx: AppContext): void {
  const ws = (): Workspace => {
    if (!ctx.workspace) throw new Error('No workspace is open')
    return ctx.workspace
  }
  const changed = (): void => {
    const win = ctx.window()
    if (win && ctx.workspace) send(win.webContents, 'tree:changed', snapshot(ctx.workspace))
  }
  const mutate =
    <P>(fn: (w: Workspace, p: P) => Promise<void>) =>
    async (p: P): Promise<void> => {
      await fn(ws(), p)
      changed()
    }

  handle('workspace:current', () => (ctx.workspace ? workspaceInfo(ctx.workspace) : null))
  handle('workspace:choose', async () => {
    const win = ctx.window()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a folder for your notes',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return openWorkspace(ctx, result.filePaths[0])
  })
  handle('tree:get', () => snapshot(ws()))
  handle('page:read', ({ id }) => ws().readPage(id))
  handle('page:write', async ({ id, blocks }) => {
    await ws().writePage(id, blocks)
  })
  handle(
    'page:meta',
    mutate((w, { id, patch }) => w.updateMeta(id, patch))
  )
  handle('page:create', async ({ parentId, index }) => {
    const node = await ws().createPage(parentId, index)
    changed()
    return node
  })
  handle(
    'page:rename',
    mutate((w, { id, title }) => w.renamePage(id, title))
  )
  handle(
    'page:move',
    mutate((w, { id, parentId, index }) => w.movePage(id, parentId, index))
  )
  handle(
    'page:trash',
    mutate((w, { id }) => w.trashPage(id))
  )
  handle(
    'page:favorite',
    mutate((w, { id, favorite }) => w.setFavorite(id, favorite))
  )
  handle('attachment:save', ({ name, data }) => ws().saveAttachment(name, data))
  handle('attachment:chooseImage', async () => {
    const win = ctx.window()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const file = result.filePaths[0]
    return ws().saveAttachment(basename(file), new Uint8Array(await readFile(file)))
  })
  handle('attachment:open', async ({ href }) => {
    const file = ws().resolveAsset(href)
    if (file) await shell.openPath(file)
  })
  handle('settings:get', () => ctx.settings.get())
  handle('settings:set', (patch) => ctx.settings.set(patch))
  handle('shell:openExternal', async ({ url }) => {
    if (/^(https?|mailto):/i.test(url)) await shell.openExternal(url)
  })
}
```

Apply this change to `src/main/workspace/state.ts`:

```diff
@@ -4,6 +4,7 @@ import { writeFileAtomic } from './fs-utils'
 
 export const APP_DIR = '.nobsidian'
 export const ROOT_ORDER_KEY = 'root'
+export const STATE_FILE = 'workspace.json'
 
 export interface WorkspaceState {
   version: 1
@@ -16,7 +17,7 @@ const empty = (): WorkspaceState => ({ version: 1, order: {}, favorites: [] })
 
 export async function loadState(root: string): Promise<WorkspaceState> {
   try {
-    const raw = JSON.parse(await readFile(join(root, APP_DIR, 'workspace.json'), 'utf8'))
+    const raw = JSON.parse(await readFile(join(root, APP_DIR, STATE_FILE), 'utf8'))
     return {
       version: 1,
       order: typeof raw.order === 'object' && raw.order ? raw.order : {},
@@ -27,10 +28,11 @@ export async function loadState(root: string): Promise<WorkspaceState> {
   }
 }
 
+export function serializeState(state: WorkspaceState): string {
+  return JSON.stringify(state, null, 2) + '\n'
+}
+
 export async function saveState(root: string, state: WorkspaceState): Promise<void> {
   await mkdir(join(root, APP_DIR), { recursive: true })
-  await writeFileAtomic(
-    join(root, APP_DIR, 'workspace.json'),
-    JSON.stringify(state, null, 2) + '\n'
-  )
+  await writeFileAtomic(join(root, APP_DIR, STATE_FILE), serializeState(state))
 }
```

Create `src/main/workspace/trash.ts`:

```ts
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { metaFromData, splitFrontmatter } from '../../shared/core/page'
import { childDirOf } from '../../shared/core/paths'
import { exists, writeFileAtomic } from './fs-utils'
import { APP_DIR } from './state'

export interface TrashMeta {
  id: string
  title: string
  originalPath: string
  parentId: string | null
  deletedAt: string
  /** Position among its siblings, so a restore puts it back in place. */
  index?: number
  favorite?: boolean
  /** Workspace path of each page the trashed pages link to -> its id, as of the delete. */
  links?: Record<string, string>
}

/** One deleted page (with its sub-pages) as stored in `.nobsidian/trash/<entry>/`. */
export interface TrashEntry {
  entry: string
  meta: TrashMeta
  /** Absolute path of the page file inside the entry. */
  file: string
  /** Absolute path of the page's child folder inside the entry (may not exist). */
  folder: string
}

const DAY_MS = 24 * 60 * 60 * 1000
export const TRASH_RETENTION_DAYS = 30

export class Trash {
  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private base(): string {
    return join(this.root, APP_DIR, 'trash')
  }

  /** Moves a page file and its child folder into a new entry. */
  async add(meta: Omit<TrashMeta, 'deletedAt'>): Promise<string> {
    const deletedAt = this.now()
    const entry = `${deletedAt.toISOString().replace(/[:.]/g, '-')}-${meta.id}`
    const dest = join(this.base(), entry)
    await mkdir(dest, { recursive: true })
    // Written first: an entry whose page never arrived is recognisable and cleaned up by list().
    const full: TrashMeta = { ...meta, deletedAt: deletedAt.toISOString() }
    await writeFileAtomic(join(dest, 'meta.json'), JSON.stringify(full, null, 2) + '\n')
    const name = basename(meta.originalPath)
    await rename(join(this.root, ...meta.originalPath.split('/')), join(dest, name))
    const folder = join(this.root, ...childDirOf(meta.originalPath).split('/'))
    if (await exists(folder)) await rename(folder, join(dest, name.slice(0, -3)))
    return entry
  }

  /** Newest first; unreadable entries are skipped, and ones left by an interrupted delete removed. */
  async list(): Promise<TrashEntry[]> {
    const names = await readdir(this.base()).catch(() => [] as string[])
    const entries: TrashEntry[] = []
    for (const name of names) {
      const entry = await this.get(name).catch(() => null)
      if (!entry) continue
      if (await exists(entry.file)) entries.push(entry)
      else await this.remove(entry)
    }
    return entries.sort((a, b) => b.meta.deletedAt.localeCompare(a.meta.deletedAt))
  }

  async get(entry: string): Promise<TrashEntry> {
    if (!/^[\w-]+$/.test(entry)) throw new Error(`Unknown trash item ${entry}`)
    const dir = join(this.base(), entry)
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as TrashMeta
    const name = basename(meta.originalPath)
    return { entry, meta, file: join(dir, name), folder: join(dir, name.slice(0, -3)) }
  }

  /** Ids of the page and every sub-page in an entry, read from their frontmatter. */
  async pageIds(entry: TrashEntry): Promise<string[]> {
    const ids = [entry.meta.id]
    const walk = async (dir: string): Promise<void> => {
      const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const item of items) {
        const path = join(dir, item.name)
        if (item.isDirectory()) await walk(path)
        else if (item.name.toLowerCase().endsWith('.md')) {
          const { data } = splitFrontmatter(await readFile(path, 'utf8'))
          const id = data ? metaFromData(data).id : undefined
          if (id && !ids.includes(id)) ids.push(id)
        }
      }
    }
    await walk(entry.folder)
    return ids
  }

  async countPages(entry: TrashEntry): Promise<number> {
    let count = 1
    const walk = async (dir: string): Promise<void> => {
      const items = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const item of items) {
        if (item.isDirectory()) await walk(join(dir, item.name))
        else if (item.name.toLowerCase().endsWith('.md')) count++
      }
    }
    await walk(entry.folder)
    return count
  }

  async remove(entry: TrashEntry): Promise<void> {
    await rm(join(this.base(), entry.entry), { recursive: true, force: true })
  }

  /** Entries deleted more than 30 days ago. */
  async expired(): Promise<TrashEntry[]> {
    const cutoff = this.now().getTime() - TRASH_RETENTION_DAYS * DAY_MS
    return (await this.list()).filter((e) => new Date(e.meta.deletedAt).getTime() < cutoff)
  }
}
```

Create `src/main/workspace/watcher.ts`:

```ts
import { watch } from 'chokidar'
import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import type { FileChange } from '../../shared/types'
import { APP_DIR, STATE_FILE } from './state'
import { ATTACHMENTS_DIR } from './workspace'

const FILE_EVENTS = new Set(['add', 'addDir', 'change', 'unlink', 'unlinkDir'])

/** Events arriving within this window are reconciled together. */
export const BATCH_MS = 150

export interface WorkspaceWatcher {
  /** Resolves once the initial scan is done and changes are being reported. */
  ready: Promise<void>
  close: () => Promise<void>
}

export function watchWorkspace(
  root: string,
  onChanges: (changes: FileChange[]) => void,
  onError: (err: unknown) => void
): WorkspaceWatcher {
  // FSEvents reports real paths, so a root reached through a symlink must be resolved first.
  const real = realpathSync.native(root)
  const rel = (abs: string): string => relative(real, abs).split(sep).join('/')
  let pending: FileChange[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    const batch = pending
    pending = []
    onChanges(batch)
  }
  const watcher = watch(real, {
    ignoreInitial: true,
    ignored: (abs) => isIgnored(rel(abs))
  })
  watcher.on('all', (kind, abs) => {
    if (!FILE_EVENTS.has(kind)) return
    pending.push({ kind: kind as FileChange['kind'], path: rel(abs) })
    timer ??= setTimeout(flush, BATCH_MS)
  })
  watcher.on('error', onError)
  const ready = new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
  return {
    ready,
    close: async () => {
      if (timer) clearTimeout(timer)
      await watcher.close()
    }
  }
}

/** Skips dot-files and folders (except the workspace state), attachments and temp files. */
export function isIgnored(path: string): boolean {
  if (path === '') return false
  const parts = path.split('/')
  if (parts[0] === APP_DIR)
    return !(parts.length === 1 || (parts.length === 2 && parts[1] === STATE_FILE))
  if (parts[0] === ATTACHMENTS_DIR) return true
  return parts.some((part) => part.startsWith('.'))
}
```

Replace the whole of `src/main/workspace/workspace.ts` with:

```ts
import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import type { Block } from '../../shared/core/blocks'
import { mapBlockLinks, pageIdFromHref, pageLinkHref } from '../../shared/core/links'
import {
  insertId,
  parsePage,
  serializePage,
  splitFrontmatter,
  metaFromData,
  type PageMeta
} from '../../shared/core/page'
import {
  childDirOf,
  decodeHref,
  dirOf,
  encodeHref,
  isExternalHref,
  joinPath,
  relativeHref,
  resolveHref,
  sanitizeTitle,
  stemOf
} from '../../shared/core/paths'
import { blocksText } from '../../shared/core/text'
import type {
  FileChange,
  HistoryVersion,
  PageDoc,
  PageMetaPatch,
  PageNode,
  SearchHit,
  TrashItem,
  WriteResult
} from '../../shared/types'
import { HistoryStore, type Snapshot, type SnapshotMeta } from '../history/store'
import { SearchIndex } from '../search/index'
import { exists, removeDirIfEmpty, uniqueName, writeFileAtomic } from './fs-utils'
import {
  APP_DIR,
  ROOT_ORDER_KEY,
  STATE_FILE,
  loadState,
  saveState,
  serializeState,
  type WorkspaceState
} from './state'
import { Trash } from './trash'

export const ATTACHMENTS_DIR = 'attachments'
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000
/** A file modified this recently may still be being written by another program. */
export const SETTLE_MS = 1000

interface PageRecord {
  id: string
  title: string
  icon?: string
  path: string
  parentId: string | null
}

/** A page file found while walking the folder. */
interface FoundFile {
  path: string
  parentPath: string | null
  text: string
  stat: string
  mtime: number
  /** Creation time, so the older of two files sharing an id keeps it. */
  born: number
  dataId?: string
}

interface ScanDiff {
  added: string[]
  removed: string[]
  changed: { id: string; oldText: string | undefined; oldPath: string }[]
}

export type WorkspaceEvent = { type: 'tree' } | { type: 'page'; id: string; revision: number }

export interface WorkspaceOptions {
  now?: () => Date
  /** How long a file must go unmodified before the app adds an id line to it. */
  settleMs?: number
}

export class Workspace {
  private pages = new Map<string, PageRecord>()
  /** Last known path of every id ever seen, so links to trashed pages still serialize. */
  private knownPaths = new Map<string, string>()
  /** Last text read or written for each page path; lets renames skip pages that cannot link. */
  private texts = new Map<string, string>()
  /** `mtime:size` of each page file when last read, so rescans skip unchanged files. */
  private stats = new Map<string, string>()
  /** Bumped when content changes other than through `writePage`, so stale editors are refused. */
  private revisions = new Map<string, number>()
  /** Pages whose current text the app wrote this session. */
  private owned = new Set<string>()
  private lastSnapshot = new Map<string, number>()
  private listeners = new Set<(event: WorkspaceEvent) => void>()
  private stateText = ''
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private indexing: Promise<void> = Promise.resolve()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly index = new SearchIndex()
  private readonly history: HistoryStore
  private readonly trash: Trash
  private readonly now: () => Date
  private readonly settleMs: number

  private constructor(
    readonly root: string,
    private state: WorkspaceState,
    options: WorkspaceOptions
  ) {
    this.now = options.now ?? (() => new Date())
    this.settleMs = options.settleMs ?? SETTLE_MS
    this.history = new HistoryStore(root, this.now)
    this.trash = new Trash(root, this.now)
  }

  static async open(root: string, options: WorkspaceOptions = {}): Promise<Workspace> {
    // Never recreate a missing folder: it may be on an unmounted drive or have been moved.
    const info = await stat(root).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`Folder not found: ${root}`)
    const ws = new Workspace(root, await loadState(root), options)
    ws.stateText = await readFile(join(root, APP_DIR, STATE_FILE), 'utf8').catch(() => '')
    await ws.scan()
    for (const r of ws.pages.values()) ws.index.setTitle(r.id, r.title)
    return ws
  }

  /** Stops background work; the workspace is not used after this. */
  close(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer)
    this.settleTimer = null
    this.listeners.clear()
  }

  /** Modified so recently that another program may still be writing it (mtime can lead the clock). */
  private unsettled(mtime: number): boolean {
    return this.settleMs > 0 && Date.now() - mtime < this.settleMs
  }

  /** Looks at the folder again once files that were still being written have settled. */
  private rescanLater(): void {
    if (this.settleTimer) return
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      void this.run(() => this.rescanChanges()).catch((err) => console.error('Rescan failed', err))
    }, this.settleMs)
  }

  onEvent(listener: (event: WorkspaceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: WorkspaceEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  /** Runs mutations one at a time so autosaves never interleave with renames. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => {})
    return next
  }

  private abs(path: string): string {
    return join(this.root, ...path.split('/'))
  }

  /** Reads a page file, treating text the app has not seen as an external change. */
  private async readCurrent(r: PageRecord): Promise<string> {
    const text = await readFile(this.abs(r.path), 'utf8')
    const known = this.texts.get(r.path)
    if (known !== undefined && known !== text) await this.applyExternal(r, text)
    else this.remember(r.path, text)
    return text
  }

  private async writeText(path: string, text: string): Promise<void> {
    await writeFileAtomic(this.abs(path), text)
    this.remember(path, text)
  }

  /** The `texts` cache changed: the recorded file stat no longer describes it. */
  private remember(path: string, text: string): void {
    this.texts.set(path, text)
    this.stats.delete(path)
  }

  private revision(id: string): number {
    return this.revisions.get(id) ?? 0
  }

  private async persist(): Promise<void> {
    this.stateText = serializeState(this.state)
    await saveState(this.root, this.state)
  }

  // ---------- scanning ----------

  /** Walks the folder and rebuilds the page maps, reusing text of files that did not change. */
  private async scan(): Promise<ScanDiff> {
    const old = { pages: this.pages, texts: this.texts, stats: this.stats }
    const walked: FoundFile[] = []
    await this.walk('', null, walked)
    const oldIdAt = new Map([...old.pages.values()].map((r) => [r.path, r.id]))
    const idOf = new Map<FoundFile, string>()
    const claimed = new Set<string>()
    // A page keeps its id at its known path, so a sync tool's conflicted copy is the one renumbered,
    // and a file whose id line an editor dropped is still the same page.
    for (const f of walked) {
      const known = oldIdAt.get(f.path)
      const id = f.dataId ?? known
      if (id && id === known && !claimed.has(id)) {
        claimed.add(id)
        idOf.set(f, id)
      }
    }
    const unsettled: string[] = []
    for (const f of [...walked].sort((a, b) => a.born - b.born)) {
      let id = idOf.get(f)
      if (id === undefined && f.dataId && !claimed.has(f.dataId)) id = f.dataId
      if (id === undefined) id = randomUUID()
      claimed.add(id)
      idOf.set(f, id)
      if (f.dataId === id) continue
      // A file another program is still writing would be cut short by writing the id now.
      if (this.unsettled(f.mtime)) {
        unsettled.push(f.path)
        continue
      }
      // Only the id is added; the rest of the file is left exactly as the user wrote it.
      f.text = insertId(f.text, id)
      await writeFileAtomic(this.abs(f.path), f.text)
      f.stat = (await fileStat(this.abs(f.path))).key
    }
    // Unsettled new pages (and their sub-pages) wait; known ones keep their id in memory meanwhile.
    const waiting = unsettled.filter((path) => !oldIdAt.has(path))
    const found = walked.filter(
      (f) => !waiting.some((w) => f.path === w || f.path.startsWith(childDirOf(w) + '/'))
    )
    if (unsettled.length) this.rescanLater()

    const pages = new Map<string, PageRecord>()
    const texts = new Map<string, string>()
    const stats = new Map<string, string>()
    const idByPath = new Map(found.map((f) => [f.path, idOf.get(f)!]))
    for (const f of found) {
      const id = idOf.get(f)!
      const { data } = splitFrontmatter(f.text)
      const meta = data ? metaFromData(data) : { extra: {} }
      pages.set(id, {
        id,
        title: meta.title ?? stemOf(f.path),
        icon: iconToInternal(f.path, meta.icon),
        path: f.path,
        parentId: f.parentPath === null ? null : (idByPath.get(f.parentPath) ?? null)
      })
      texts.set(f.path, f.text)
      stats.set(f.path, f.stat)
      this.knownPaths.set(id, f.path)
    }

    const diff: ScanDiff = { added: [], removed: [], changed: [] }
    for (const [id, r] of pages) {
      const prev = old.pages.get(id)
      if (!prev) diff.added.push(id)
      else if (old.texts.get(prev.path) !== texts.get(r.path)) {
        diff.changed.push({ id, oldText: old.texts.get(prev.path), oldPath: prev.path })
      }
    }
    for (const id of old.pages.keys()) if (!pages.has(id)) diff.removed.push(id)
    this.pages = pages
    this.texts = texts
    this.stats = stats
    return diff
  }

  private async walk(dir: string, parentPath: string | null, found: FoundFile[]): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(this.abs(dir), { withFileTypes: true })
    } catch {
      return
    }
    const files = new Set(
      entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md')).map((e) => e.name)
    )
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
    // A folder without a page file becomes a page so its children stay reachable.
    for (const name of dirs) {
      if (dir === '' && name === ATTACHMENTS_DIR) continue
      // macOS volumes are usually case-insensitive: "notes/" belongs to "Notes.md".
      const owned = [...files].some((f) => f.slice(0, -3).toLowerCase() === name.toLowerCase())
      const pageFile = joinPath(dir, `${name}.md`)
      if (!owned && !(await exists(this.abs(pageFile)))) {
        await writeFileAtomic(this.abs(pageFile), '')
        files.add(`${name}.md`)
      }
    }
    for (const file of [...files].sort()) {
      if (file.startsWith('.')) continue
      const path = joinPath(dir, file)
      const info = await fileStat(this.abs(path)).catch(() => null)
      if (info === null) continue
      const cached = this.stats.get(path) === info.key ? this.texts.get(path) : undefined
      const text = cached ?? (await readFile(this.abs(path), 'utf8').catch(() => null))
      if (text === null) continue
      const { data } = splitFrontmatter(text)
      found.push({
        path,
        parentPath,
        text,
        stat: info.key,
        mtime: info.mtime,
        born: info.born,
        dataId: data ? metaFromData(data).id : undefined
      })
      await this.walk(childDirOf(path), path, found)
    }
  }

  /** Indexes every page's text for search in the background; searches wait for it. */
  indexContent(): Promise<void> {
    this.indexing = this.indexAll()
    return this.indexing
  }

  private async indexAll(): Promise<void> {
    let done = 0
    for (const id of [...this.pages.keys()]) {
      const r = this.pages.get(id)
      const text = r && this.texts.get(r.path)
      if (r && text !== undefined) this.indexText(r, text)
      if (++done % 50 === 0) await new Promise((resolve) => setImmediate(resolve))
    }
  }

  private indexText(r: PageRecord, text: string): void {
    this.index.set(r.id, r.title, blocksText(parsePage(text).blocks))
  }

  /** Prunes old history and purges expired trash; runs in the background after opening. */
  async maintain(): Promise<void> {
    await this.history.prune()
    await this.run(async () => {
      for (const entry of await this.trash.expired()) await this.deleteEntry(entry.entry)
    })
  }

  // ---------- external changes ----------

  /** Applies a batch of file events; the disk is the source of truth. */
  reconcile(changes: FileChange[]): Promise<void> {
    return this.run(async () => {
      const byPath = this.pathIndex()
      let structural = false
      let stateChanged = false
      const edited = new Set<string>()
      for (const { kind, path } of changes) {
        if (path === `${APP_DIR}/${STATE_FILE}`) stateChanged = true
        else if (kind === 'add' || kind === 'change') {
          if (!path.toLowerCase().endsWith('.md')) continue
          if (byPath.has(path)) edited.add(path)
          else structural = true
        } else if (kind === 'unlink') {
          if (byPath.has(path)) structural = true
        } else if (kind === 'addDir') {
          const ours = path === ATTACHMENTS_DIR || path === APP_DIR
          if (!ours && !byPath.has(`${path}.md`)) structural = true
        } else if ([...byPath.keys()].some((p) => p === `${path}.md` || p.startsWith(`${path}/`))) {
          structural = true
        }
      }
      if (stateChanged) await this.reloadState()
      if (structural) return this.rescanChanges()
      for (const path of edited) {
        const r = this.pages.get(byPath.get(path)!)
        const text = await readFile(this.abs(path), 'utf8').catch(() => null)
        if (r && text !== null && text !== this.texts.get(path)) await this.applyExternal(r, text)
      }
    })
  }

  private async rescanChanges(): Promise<void> {
    const diff = await this.scan()
    for (const id of diff.added)
      this.indexText(this.pages.get(id)!, this.texts.get(this.pages.get(id)!.path)!)
    for (const id of diff.removed) {
      this.index.remove(id)
      this.owned.delete(id)
    }
    for (const r of this.pages.values()) this.index.setTitle(r.id, r.title)
    for (const { id, oldText, oldPath } of diff.changed) {
      const r = this.pages.get(id)!
      await this.contentChanged(r, oldText, oldPath)
    }
    this.emit({ type: 'tree' })
  }

  private async applyExternal(r: PageRecord, text: string): Promise<void> {
    const oldText = this.texts.get(r.path)
    let current = text
    const { data } = splitFrontmatter(text)
    const meta = data ? metaFromData(data) : { extra: {} as Record<string, unknown> }
    if (data && !meta.id) {
      // An editor dropped the id line; put it back once the file is no longer being written.
      const { mtime } = await fileStat(this.abs(r.path))
      if (this.unsettled(mtime)) this.rescanLater()
      else {
        current = insertId(text, r.id)
        await writeFileAtomic(this.abs(r.path), current)
      }
    }
    this.remember(r.path, current)
    const title = meta.title ?? stemOf(r.path)
    const icon = iconToInternal(r.path, meta.icon)
    const treeChanged = title !== r.title || icon !== r.icon
    r.title = title
    r.icon = icon
    await this.contentChanged(r, oldText, r.path)
    if (treeChanged) this.emit({ type: 'tree' })
  }

  /** Keeps what the app had in history, then tells the renderer the page changed underneath it. */
  private async contentChanged(
    r: PageRecord,
    oldText: string | undefined,
    oldPath: string
  ): Promise<void> {
    // What the user wrote here is always kept; text from elsewhere at most every 10 minutes.
    const now = this.now().getTime()
    const due = now - (this.lastSnapshot.get(r.id) ?? 0) >= SNAPSHOT_INTERVAL_MS
    if (oldText !== undefined && (this.owned.has(r.id) || due)) {
      await this.snapshot(r.id, oldText, oldPath)
      this.lastSnapshot.set(r.id, now)
    }
    this.owned.delete(r.id)
    const revision = this.revision(r.id) + 1
    this.revisions.set(r.id, revision)
    this.indexText(r, this.texts.get(r.path) ?? '')
    this.emit({ type: 'page', id: r.id, revision })
  }

  private async reloadState(): Promise<void> {
    const text = await readFile(join(this.root, APP_DIR, STATE_FILE), 'utf8').catch(() => '')
    if (text === this.stateText) return
    this.stateText = text
    this.state = await loadState(this.root)
    this.emit({ type: 'tree' })
  }

  // ---------- queries ----------

  tree(): PageNode[] {
    const groups = this.groupChildren()
    const build = (parentId: string | null): PageNode[] =>
      (groups.get(parentId) ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        icon: r.icon,
        path: r.path,
        children: build(r.id)
      }))
    return build(null)
  }

  favorites(): string[] {
    return this.state.favorites.filter((id) => this.pages.has(id))
  }

  async search(query: string): Promise<SearchHit[]> {
    await this.indexing
    return this.index.search(query).filter((hit) => this.pages.has(hit.id))
  }

  /** Every parent's children in sidebar order, built in one pass. */
  private groupChildren(): Map<string | null, PageRecord[]> {
    const groups = new Map<string | null, PageRecord[]>()
    for (const r of this.pages.values()) {
      const list = groups.get(r.parentId)
      if (list) list.push(r)
      else groups.set(r.parentId, [r])
    }
    for (const [parentId, kids] of groups) {
      const order = this.state.order[parentId ?? ROOT_ORDER_KEY] ?? []
      const rank = new Map(order.map((id, i) => [id, i]))
      const at = (r: PageRecord): number => rank.get(r.id) ?? Number.MAX_SAFE_INTEGER
      kids.sort(
        (a, b) => at(a) - at(b) || a.title.localeCompare(b.title, undefined, { numeric: true })
      )
    }
    return groups
  }

  private childrenOf(parentId: string | null): PageRecord[] {
    return this.groupChildren().get(parentId) ?? []
  }

  private record(id: string): PageRecord {
    const r = this.pages.get(id)
    if (!r) throw new Error(`Unknown page ${id}`)
    return r
  }

  private descendantsOf(id: string): PageRecord[] {
    const groups = this.groupChildren()
    const out: PageRecord[] = []
    const walk = (parentId: string): void => {
      for (const child of groups.get(parentId) ?? []) {
        out.push(child)
        walk(child.id)
      }
    }
    walk(id)
    return out
  }

  // ---------- reading and writing ----------

  /** Queued like writes, so a page never loads content that a pending save is replacing. */
  readPage(id: string): Promise<PageDoc> {
    return this.run(async () => {
      const r = this.record(id)
      const text = await this.readCurrent(r)
      return { ...this.toDoc(r.path, text), id, title: r.title, revision: this.revision(id) }
    })
  }

  /** A page as the editor sees it, with links resolved against the file at `path`. */
  private toDoc(path: string, text: string, linkIds: Record<string, string> = {}): PageDoc {
    const { meta, blocks, frontmatterError } = parsePage(text)
    const byPath = this.pathIndex()
    for (const [target, id] of Object.entries(linkIds)) {
      if (this.pages.has(id)) byPath.set(target, id)
    }
    return {
      id: meta.id ?? '',
      title: meta.title ?? stemOf(path),
      path,
      meta: this.metaToInternal(path, meta, byPath),
      blocks: mapBlockLinks(blocks, (href) => this.toInternalHref(path, href, byPath)),
      revision: 0,
      ...(frontmatterError ? { frontmatterError } : {})
    }
  }

  /**
   * Saves the editor's blocks. Refused when the page changed underneath the editor since it
   * loaded `revision`, unless `force` (the user chose to keep their version).
   */
  writePage(
    id: string,
    blocks: Block[],
    options: { revision?: number; force?: boolean } = {}
  ): Promise<WriteResult> {
    return this.run(async () => {
      const r = this.pages.get(id)
      const disk = r ? await this.readCurrent(r).catch(() => null) : null
      if (!r || disk === null) {
        await this.saveDraft(id, blocks)
        return { ok: false, reason: 'gone' }
      }
      const revision = this.revision(id)
      if (options.revision !== undefined && options.revision !== revision && !options.force) {
        return { ok: false, reason: 'conflict' }
      }
      const { meta } = parsePage(disk)
      const fileBlocks = mapBlockLinks(blocks, (href) => this.toFileHref(r.path, href))
      await this.writeOwn(r, disk, serializePage({ ...meta, id }, fileBlocks))
      this.index.set(id, r.title, blocksText(blocks))
      return { ok: true, revision }
    })
  }

  /** Keeps edits that cannot go to the page (changed or deleted outside the app) in its history. */
  keepDraft(id: string, blocks: Block[]): Promise<void> {
    return this.run(() => this.saveDraft(id, blocks))
  }

  private async saveDraft(id: string, blocks: Block[]): Promise<void> {
    const r = this.pages.get(id)
    const path = r?.path ?? this.knownPaths.get(id) ?? `${id}.md`
    const base = r ? this.texts.get(r.path) : undefined
    const meta = base ? parsePage(base).meta : { extra: {} }
    const fileBlocks = mapBlockLinks(blocks, (href) => this.toFileHref(path, href))
    await this.snapshot(id, serializePage({ ...meta, id }, fileBlocks), path)
  }

  updateMeta(id: string, patch: PageMetaPatch): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const disk = await this.readCurrent(r)
      const { meta, blocks } = parsePage(disk)
      const next: PageMeta = { ...meta, id }
      if (patch.icon !== undefined)
        next.icon = patch.icon ? this.metaHrefToFile(r.path, patch.icon) : undefined
      if (patch.cover !== undefined)
        next.cover = patch.cover ? this.toFileHref(r.path, patch.cover) : undefined
      if (patch.coverPosition !== undefined) next.coverPosition = patch.coverPosition ?? undefined
      if (patch.fullWidth !== undefined) next.fullWidth = patch.fullWidth
      await this.writeOwn(r, disk, serializePage(next, blocks))
      if (patch.icon !== undefined) r.icon = patch.icon ?? undefined
    })
  }

  /** Writes content the user made, keeping history: the text it replaces and a periodic copy. */
  private async writeOwn(r: PageRecord, disk: string, text: string): Promise<void> {
    const now = this.now().getTime()
    if (!this.owned.has(r.id)) {
      await this.snapshot(r.id, disk, r.path)
      this.owned.add(r.id)
      this.lastSnapshot.set(r.id, now)
    }
    await this.writeText(r.path, text)
    if (now - (this.lastSnapshot.get(r.id) ?? 0) >= SNAPSHOT_INTERVAL_MS) {
      await this.snapshot(r.id, text, r.path)
      this.lastSnapshot.set(r.id, now)
    }
  }

  // ---------- history ----------

  private async snapshot(id: string, text: string, path: string): Promise<void> {
    // An empty page has nothing worth restoring.
    if (splitFrontmatter(text).body.trim() === '') return
    try {
      await this.history.save(id, text, this.snapshotMeta(path, text))
    } catch (err) {
      console.error(`Could not save history for ${path}`, err)
    }
  }

  private snapshotMeta(path: string, text: string): SnapshotMeta {
    return { path, links: this.linkIds(path, text, this.pathIndex()) }
  }

  /** The id of every page the file at `path` links to, by the workspace path it links with. */
  private linkIds(path: string, text: string, byPath: Map<string, string>): Record<string, string> {
    const links: Record<string, string> = {}
    const { meta, blocks } = parsePage(text)
    const note = (href: string): string => {
      if (!isExternalHref(href)) {
        const target = resolveHref(path, href)
        const id = byPath.get(target)
        if (id) links[target] = id
      }
      return href
    }
    mapBlockLinks(blocks, note)
    if (meta.cover) note(meta.cover)
    return links
  }

  /** Saves what the user wrote, if it is not in history yet (leaving a page, quitting). */
  checkpoint(id?: string): Promise<void> {
    return this.run(async () => {
      for (const pageId of id ? [id] : [...this.owned]) {
        const r = this.pages.get(pageId)
        const text = r && this.texts.get(r.path)
        if (!r || text === undefined || !this.owned.has(pageId)) continue
        await this.snapshot(pageId, text, r.path)
        this.lastSnapshot.set(pageId, this.now().getTime())
      }
    })
  }

  /** Newest first; the newest is always what is on disk now, even if another app wrote it. */
  listHistory(id: string): Promise<HistoryVersion[]> {
    return this.run(async () => {
      const r = this.record(id)
      const text = await this.readCurrent(r)
      await this.history.save(id, text, this.snapshotMeta(r.path, text))
      return this.history.list(id)
    })
  }

  readHistory(id: string, version: string): Promise<PageDoc> {
    return this.run(async () => {
      const r = this.record(id)
      const doc = this.snapshotDoc(r, await this.history.read(id, version))
      return { ...doc, revision: this.revision(id) }
    })
  }

  private snapshotDoc(r: PageRecord, snap: Snapshot): PageDoc {
    const doc = this.toDoc(snap.meta.path || r.path, snap.text, snap.meta.links)
    return { ...doc, id: r.id, title: r.title, path: r.path }
  }

  /** Replaces content, icon and cover with a snapshot's; title and location stay. */
  restoreHistory(id: string, version: string): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const doc = this.snapshotDoc(r, await this.history.read(id, version))
      const disk = await this.readCurrent(r)
      const { meta: current } = parsePage(disk)
      await this.snapshot(id, disk, r.path)
      this.owned.add(id)
      const meta: PageMeta = {
        ...doc.meta,
        id,
        title: current.title,
        icon: doc.meta.icon ? this.metaHrefToFile(r.path, doc.meta.icon) : undefined,
        cover: doc.meta.cover ? this.toFileHref(r.path, doc.meta.cover) : undefined
      }
      const fileBlocks = mapBlockLinks(doc.blocks, (href) => this.toFileHref(r.path, href))
      await this.writeText(r.path, serializePage(meta, fileBlocks))
      r.icon = doc.meta.icon
      const revision = this.revision(id) + 1
      this.revisions.set(id, revision)
      this.index.set(id, r.title, blocksText(doc.blocks))
      this.emit({ type: 'page', id, revision })
    })
  }

  // ---------- structure changes ----------

  createPage(parentId: string | null, index?: number): Promise<PageNode> {
    return this.run(async () => {
      const parent = parentId ? this.record(parentId) : null
      const dir = parent ? childDirOf(parent.path) : ''
      await mkdir(this.abs(dir), { recursive: true })
      // New pages start with an empty title (shown as an "Untitled" placeholder), like Notion.
      const title = ''
      const stem = await this.pageStem(dir, title)
      const path = joinPath(dir, `${stem}.md`)
      const id = randomUUID()
      const meta: PageMeta = { id, extra: {}, ...(stem !== title ? { title } : {}) }
      await this.writeText(path, serializePage(meta, []))
      const record: PageRecord = { id, title, path, parentId }
      this.pages.set(id, record)
      this.knownPaths.set(id, path)
      this.index.set(id, title, '')
      this.insertOrder(parentId, id, index)
      await this.persist()
      return { id, title, path, children: [] }
    })
  }

  /** Copies a page and its sub-pages next to it; links inside the copy point to the copies. */
  duplicatePage(id: string): Promise<PageNode> {
    return this.run(async () => {
      const source = this.record(id)
      const subtree = [source, ...this.descendantsOf(id)]
      const dir = dirOf(source.path)
      const title = `${source.title || 'Untitled'} (1)`
      const stem = await this.pageStem(dir, title)
      const rootPath = joinPath(dir, `${stem}.md`)
      const newIds = new Map(subtree.map((r) => [r.id, randomUUID()]))
      const copies = subtree.map((r): PageRecord & { from: PageRecord } => ({
        from: r,
        id: newIds.get(r.id)!,
        title: r === source ? title : r.title,
        icon: r.icon,
        path:
          r === source
            ? rootPath
            : childDirOf(rootPath) + r.path.slice(childDirOf(source.path).length),
        parentId: r === source ? source.parentId : newIds.get(r.parentId!)!
      }))
      for (const c of copies) {
        this.pages.set(c.id, {
          id: c.id,
          title: c.title,
          icon: c.icon,
          path: c.path,
          parentId: c.parentId
        })
        this.knownPaths.set(c.id, c.path)
      }
      const remap = (href: string): string => {
        const pageId = pageIdFromHref(href)
        const copy = pageId && newIds.get(pageId)
        return copy ? pageLinkHref(copy) : href
      }
      for (const c of copies) {
        const doc = this.toDoc(c.from.path, await this.readCurrent(c.from))
        const meta: PageMeta = {
          ...doc.meta,
          id: c.id,
          title: stemOf(c.path) === c.title ? undefined : c.title,
          icon: doc.meta.icon ? this.metaHrefToFile(c.path, doc.meta.icon) : undefined,
          cover: doc.meta.cover ? this.toFileHref(c.path, doc.meta.cover) : undefined
        }
        const blocks = mapBlockLinks(doc.blocks, remap)
        await mkdir(this.abs(dirOf(c.path)), { recursive: true })
        const fileBlocks = mapBlockLinks(blocks, (href) => this.toFileHref(c.path, href))
        await this.writeText(c.path, serializePage(meta, fileBlocks))
        this.index.set(c.id, c.title, blocksText(blocks))
        const order = this.state.order[c.from.id]
        if (order) this.state.order[c.id] = order.map((child) => newIds.get(child) ?? child)
      }
      const siblings = this.childrenOf(source.parentId).filter((r) => r.id !== copies[0].id)
      this.insertOrder(source.parentId, copies[0].id, siblings.indexOf(source) + 1)
      await this.persist()
      return this.nodeOf(copies[0].id)
    })
  }

  private nodeOf(id: string): PageNode {
    const find = (nodes: PageNode[]): PageNode | null => {
      for (const n of nodes) {
        if (n.id === id) return n
        const hit = find(n.children)
        if (hit) return hit
      }
      return null
    }
    return find(this.tree())!
  }

  renamePage(id: string, title: string): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const dir = dirOf(r.path)
      const stem = await this.pageStem(dir, title, stemOf(r.path))
      await this.relocate(r, dir, stem)
      r.title = title
      this.index.setTitle(id, title)
      await this.syncTitleField(r)
    })
  }

  movePage(id: string, newParentId: string | null, index: number): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      if (
        newParentId === id ||
        (newParentId && this.descendantsOf(id).some((d) => d.id === newParentId))
      ) {
        throw new Error('A page cannot be moved inside itself')
      }
      this.removeOrder(r.parentId, id)
      if (newParentId !== r.parentId) {
        const parent = newParentId ? this.record(newParentId) : null
        const dir = parent ? childDirOf(parent.path) : ''
        await mkdir(this.abs(dir), { recursive: true })
        const oldDir = dirOf(r.path)
        const stem = await this.pageStem(dir, r.title)
        await this.relocate(r, dir, stem)
        r.parentId = newParentId
        await this.syncTitleField(r)
        await removeDirIfEmpty(this.abs(oldDir))
      }
      this.insertOrder(newParentId, id, index)
      await this.persist()
    })
  }

  // ---------- trash ----------

  trashPage(id: string): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const removed = [r, ...this.descendantsOf(id)]
      const byPath = this.pathIndex()
      const links: Record<string, string> = {}
      for (const d of removed) {
        const text = this.texts.get(d.path) ?? ''
        Object.assign(links, this.linkIds(d.path, text, byPath))
      }
      await this.trash.add({
        id,
        title: r.title,
        originalPath: r.path,
        parentId: r.parentId,
        index: this.childrenOf(r.parentId).indexOf(r),
        favorite: this.state.favorites.includes(id),
        links
      })
      for (const d of removed) {
        this.pages.delete(d.id)
        this.texts.delete(d.path)
        this.stats.delete(d.path)
        this.index.remove(d.id)
        this.owned.delete(d.id)
      }
      this.removeOrder(r.parentId, id)
      this.state.favorites = this.state.favorites.filter((f) => this.pages.has(f))
      await removeDirIfEmpty(this.abs(dirOf(r.path)))
      await this.persist()
    })
  }

  listTrash(): Promise<TrashItem[]> {
    return this.run(async () => {
      const items: TrashItem[] = []
      for (const e of await this.trash.list()) {
        const text = await readFile(e.file, 'utf8').catch(() => '')
        const { data } = splitFrontmatter(text)
        const parent = e.meta.parentId ? this.pages.get(e.meta.parentId) : undefined
        items.push({
          entry: e.entry,
          pageId: e.meta.id,
          title: e.meta.title,
          icon: iconToInternal(e.meta.originalPath, data ? metaFromData(data).icon : undefined),
          parentTitle: parent ? parent.title || 'Untitled' : null,
          deletedAt: e.meta.deletedAt,
          pageCount: await this.trash.countPages(e)
        })
      }
      return items
    })
  }

  readTrash(entry: string): Promise<PageDoc> {
    return this.run(async () => {
      const e = await this.trash.get(entry)
      const doc = this.toDoc(e.meta.originalPath, await readFile(e.file, 'utf8'))
      return { ...doc, id: e.meta.id, title: e.meta.title }
    })
  }

  /** Puts a page back where it was, or at the top level if its parent is gone. */
  restoreTrash(entry: string): Promise<string> {
    return this.run(async () => {
      const e = await this.trash.get(entry)
      const parent = e.meta.parentId ? (this.pages.get(e.meta.parentId) ?? null) : null
      const dir = parent ? childDirOf(parent.path) : ''
      await mkdir(this.abs(dir), { recursive: true })
      const stem = await this.pageStem(dir, e.meta.title)
      const path = joinPath(dir, `${stem}.md`)
      await rename(e.file, this.abs(path))
      if (await exists(e.folder)) await rename(e.folder, this.abs(childDirOf(path)))
      await this.trash.remove(e)
      await this.rescanChanges()
      // Found by path: if a live page holds the same id, the scan gave this one a new id.
      const r = this.record(this.pathIndex().get(path)!)
      const restored = [r, ...this.descendantsOf(r.id)]
      const moved = new Map<string, string>()
      if (path !== e.meta.originalPath) {
        moved.set(e.meta.originalPath, path)
        const oldChildDir = childDirOf(e.meta.originalPath)
        for (const d of restored.slice(1)) {
          moved.set(oldChildDir + d.path.slice(childDirOf(path).length), d.path)
        }
      }
      await this.relinkRestored(restored, moved, e.meta.links ?? {})
      r.title = e.meta.title
      this.index.setTitle(r.id, r.title)
      await this.syncTitleField(r)
      const sameParent = (parent?.id ?? null) === e.meta.parentId
      this.insertOrder(parent?.id ?? null, r.id, sameParent ? e.meta.index : undefined)
      if (e.meta.favorite && !this.state.favorites.includes(r.id)) this.state.favorites.push(r.id)
      await this.persist()
      return r.id
    })
  }

  deleteTrash(entry: string): Promise<void> {
    return this.run(() => this.deleteEntry(entry))
  }

  private async deleteEntry(entry: string): Promise<void> {
    const e = await this.trash.get(entry)
    // A live page can share an id with a trashed one (a sync tool recreated it); its history stays.
    const ids = (await this.trash.pageIds(e)).filter((id) => !this.pages.has(id))
    await this.history.remove(ids)
    await this.trash.remove(e)
  }

  setFavorite(id: string, favorite: boolean): Promise<void> {
    return this.run(async () => {
      this.record(id)
      const rest = this.state.favorites.filter((f) => f !== id)
      this.state.favorites = favorite ? [...rest, id] : rest
      await this.persist()
    })
  }

  /** Saves bytes under attachments/ and returns the internal href for them. */
  saveAttachment(name: string, data: Uint8Array): Promise<string> {
    return this.run(async () => {
      const dir = this.abs(ATTACHMENTS_DIR)
      await mkdir(dir, { recursive: true })
      const ext = extname(name)
      const base = sanitizeTitle(basename(name, ext)) || 'file'
      const stem = await uniqueName(dir, base, ext)
      await writeFileAtomic(join(dir, stem + ext), data)
      return '/' + encodeHref(`${ATTACHMENTS_DIR}/${stem}${ext}`)
    })
  }

  /** Absolute path for an internal `/…` href, refusing anything outside the workspace. */
  resolveAsset(internalHref: string): string | null {
    const rel = joinPath(decodeHref(internalHref))
    if (rel === '' || rel.startsWith(APP_DIR)) return null
    return this.abs(rel)
  }

  // ---------- moving files and rewriting links ----------

  private pageStem(dir: string, title: string, allow?: string): Promise<string> {
    return uniqueName(this.abs(dir), sanitizeTitle(title), '.md', {
      allow,
      reserved: dir === '' ? [ATTACHMENTS_DIR] : []
    })
  }

  /** Stores the exact title in frontmatter only when the filename cannot carry it. */
  private async syncTitleField(r: PageRecord): Promise<void> {
    const { meta, blocks } = parsePage(await this.readCurrent(r))
    const title = stemOf(r.path) === r.title ? undefined : r.title
    if (meta.title === title) return
    await this.writeText(r.path, serializePage({ ...meta, id: r.id, title }, blocks))
  }

  /** Moves a page file (and its child folder) to `dir/stem.md`, then fixes links everywhere. */
  private async relocate(r: PageRecord, dir: string, stem: string): Promise<void> {
    const oldPath = r.path
    const newPath = joinPath(dir, `${stem}.md`)
    if (oldPath === newPath) return
    const moved = new Map<string, string>()
    const oldChildDir = childDirOf(oldPath)
    const newChildDir = childDirOf(newPath)
    moved.set(oldPath, newPath)
    for (const d of this.descendantsOf(r.id)) {
      moved.set(d.path, newChildDir + d.path.slice(oldChildDir.length))
    }
    await rename(this.abs(oldPath), this.abs(newPath))
    if (await exists(this.abs(oldChildDir)))
      await rename(this.abs(oldChildDir), this.abs(newChildDir))
    for (const rec of [r, ...this.descendantsOf(r.id)]) {
      const next = moved.get(rec.path) ?? rec.path
      const text = this.texts.get(rec.path)
      this.texts.delete(rec.path)
      this.stats.delete(rec.path)
      if (text !== undefined) this.remember(next, text)
      rec.path = next
      this.knownPaths.set(rec.id, rec.path)
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
    for (const rec of this.pages.values()) {
      if (skip.has(rec.id)) continue
      const cached = this.texts.get(rec.path)
      const candidate =
        newToOld.has(rec.path) || cached === undefined || needles.some((n) => cached.includes(n))
      if (!candidate) continue
      await this.relink(rec, newToOld.get(rec.path) ?? rec.path, (t) => moved.get(t) ?? t)
    }
  }

  /** After a restore: the restored pages' own links, then links elsewhere to their old paths. */
  private async relinkRestored(
    restored: PageRecord[],
    moved: Map<string, string>,
    linkIds: Record<string, string>
  ): Promise<void> {
    const newToOld = new Map([...moved].map(([o, n]) => [n, o]))
    for (const rec of restored) {
      // Through ids, so targets renamed while this page was in Trash are still found.
      await this.relink(rec, newToOld.get(rec.path) ?? rec.path, (target) => {
        const id = linkIds[target]
        return moved.get(target) ?? (id ? this.pages.get(id)?.path : undefined) ?? target
      })
    }
    // A page created at an old path since the delete keeps the links that now point to it.
    const byPath = this.pathIndex()
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
    const { meta, blocks } = parsePage(await this.readCurrent(rec))
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
    if (changed) await this.writeText(rec.path, serializePage(nextMeta, nextBlocks))
  }

  // ---------- href translation between disk and editor ----------

  private pathIndex(): Map<string, string> {
    return new Map([...this.pages.values()].map((r) => [r.path, r.id]))
  }

  private toInternalHref(pagePath: string, href: string, byPath: Map<string, string>): string {
    if (isExternalHref(href)) return href
    const target = resolveHref(pagePath, href)
    const id = byPath.get(target)
    return id ? pageLinkHref(id) : '/' + encodeHref(target)
  }

  private toFileHref(pagePath: string, href: string): string {
    const pageId = pageIdFromHref(href)
    if (pageId) {
      const target = this.pages.get(pageId)?.path ?? this.knownPaths.get(pageId)
      return target ? relativeHref(pagePath, target) : href
    }
    if (href.startsWith('/') && !href.startsWith('//'))
      return relativeHref(pagePath, decodeHref(href))
    return href
  }

  private metaToInternal(pagePath: string, meta: PageMeta, byPath: Map<string, string>): PageMeta {
    return {
      ...meta,
      icon: iconToInternal(pagePath, meta.icon),
      cover: meta.cover ? this.toInternalHref(pagePath, meta.cover, byPath) : undefined
    }
  }

  private metaHrefToFile(pagePath: string, icon: string): string {
    return icon.startsWith('/') ? this.toFileHref(pagePath, icon) : icon
  }

  // ---------- ordering ----------

  private insertOrder(parentId: string | null, id: string, index?: number): void {
    const key = parentId ?? ROOT_ORDER_KEY
    const current = this.childrenOf(parentId)
      .map((r) => r.id)
      .filter((x) => x !== id)
    const at = index === undefined ? current.length : Math.max(0, Math.min(index, current.length))
    current.splice(at, 0, id)
    this.state.order[key] = current
  }

  private removeOrder(parentId: string | null, id: string): void {
    const key = parentId ?? ROOT_ORDER_KEY
    const list = this.state.order[key]
    if (list) this.state.order[key] = list.filter((x) => x !== id)
  }
}

/** Image icons are kept as workspace paths so they survive the page moving. */
function iconToInternal(pagePath: string, icon: string | undefined): string | undefined {
  if (!icon || !icon.includes('/') || isExternalHref(icon)) return icon
  return '/' + encodeHref(resolveHref(pagePath, icon))
}

async function fileStat(path: string): Promise<{ key: string; mtime: number; born: number }> {
  const s = await stat(path)
  return { key: `${s.mtimeMs}:${s.size}`, mtime: s.mtimeMs, born: s.birthtimeMs }
}
```

Apply this change to `src/shared/types.ts`:

```diff
@@ -22,6 +22,34 @@ export interface PageDoc {
   path: string
   meta: PageMeta
   blocks: Block[]
+  /** Bumped when the file changes other than through the editor's own saves. */
+  revision: number
+  /** The frontmatter is not valid YAML, so it is shown as text. */
+  frontmatterError?: boolean
+}
+
+export type WriteResult =
+  | { ok: true; revision: number }
+  /** `conflict`: the file changed since the editor loaded it. `gone`: the page was deleted. */
+  | { ok: false; reason: 'conflict' | 'gone' }
+
+/** A watcher event, with a workspace-relative posix path. */
+export interface FileChange {
+  kind: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'
+  path: string
+}
+
+export interface TrashItem {
+  /** Folder name under `.nobsidian/trash/`. */
+  entry: string
+  pageId: string
+  title: string
+  icon?: string
+  /** Title of the original parent if it still exists; null for top-level pages or a missing parent. */
+  parentTitle: string | null
+  deletedAt: string
+  /** The page plus its sub-pages. */
+  pageCount: number
 }
 
 export interface PageMetaPatch {
```

- [ ] **Step 5: Run the tests and checks**

Run: `pnpm exec vitest run && pnpm typecheck && pnpm lint`
Expected: 156 unit tests pass; no type or lint errors.

Then run the watcher tests 10 times, since they use the real file system: `for i in $(seq 1 10); do pnpm exec vitest run src/main/workspace/watcher.test.ts || break; done`
Expected: every run passes.

- [ ] **Step 6: Commit (ask Dale first)**

```bash
git add package.json pnpm-lock.yaml src/main/handlers.ts src/main/workspace/external.test.ts src/main/workspace/history.test.ts src/main/workspace/state.ts src/main/workspace/trash.test.ts src/main/workspace/trash.ts src/main/workspace/watcher.test.ts src/main/workspace/watcher.ts src/main/workspace/workspace.test.ts src/main/workspace/workspace.ts src/shared/types.ts
git commit -m "Add history, trash, duplicate, search and live file changes to the workspace"
```


---

### Task 5: Main process wiring

Exposes the new `Workspace` features over IPC, starts the watcher with each workspace (and closes it, with a checkpoint, when the workspace closes), indexes page text in the background, prunes history and purges old trash shortly after start, and checkpoints every page the app wrote when quitting.
If the workspace folder disappears, the renderer is told and shows the existing "Can't find your notes" screen.
"Open Folder…" now goes through the renderer, so pending edits are saved to the workspace they belong to before switching.
The end-to-end helpers move into `e2e/helpers.ts` so the new specs can share them.

**Files:**
- Modify: `src/main/handlers.ts`, `src/main/index.ts`, `src/main/menu.ts`, `src/main/settings.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/PageEditor.tsx`, `src/renderer/src/store.ts`, `src/shared/ipc.ts`
- Test: `e2e/app.spec.ts`, `e2e/external.spec.ts`, `e2e/helpers.ts`

**Interfaces:**
- Consumes: the Task 4 `Workspace` API and `watchWorkspace`.
- Produces: IPC channels `page:write` (payload `{ id, blocks, revision, force? }`, result `WriteResult`), `page:duplicate`, `search:query`, `trash:list|read|restore|delete`, `history:list|read|restore|checkpoint|draft`; events `page:changed` (`{ id, revision }`) and `workspace:missing`; `Settings.recent: Record<string, string[]>` and `Settings.lastColor: { kind: 'text' | 'background'; color: string }`; `RECENT_LIMIT = 20`; `MenuCommand` adds `'open-folder'` and `'search'` (Cmd+P); store action `workspaceMissing()`; e2e helpers `editor`, `typeNewPageTitle`, `waitForFile`, `newPage`, `rowAction`.

- [ ] **Step 1: Write the failing tests**

Apply this change to `e2e/app.spec.ts`:

```diff
@@ -1,30 +1,10 @@
-import { readFile, readdir, writeFile } from 'node:fs/promises'
+import { readdir, writeFile } from 'node:fs/promises'
 import { join } from 'node:path'
-import { _electron as electron, type Page } from '@playwright/test'
+import { _electron as electron } from '@playwright/test'
 import { mkdtemp } from 'node:fs/promises'
 import { tmpdir } from 'node:os'
 import { expect, test } from './fixtures'
-
-const editor = '.bn-editor'
-
-/** Waits until the freshly created page is showing, so typing can't land in the previous one. */
-async function typeNewPageTitle(page: Page, title: string): Promise<void> {
-  const heading = page.getByTestId('page-title')
-  await expect(heading).toHaveText('')
-  await expect(heading).toBeFocused()
-  await page.keyboard.type(title)
-}
-
-async function waitForFile(path: string, match: RegExp | string): Promise<string> {
-  let text = ''
-  await expect
-    .poll(async () => {
-      text = await readFile(path, 'utf8').catch(() => '')
-      return typeof match === 'string' ? text.includes(match) : match.test(text)
-    })
-    .toBe(true)
-  return text
-}
+import { editor, typeNewPageTitle, waitForFile } from './helpers'
 
 test('first run asks for a folder and creates the first page', async () => {
   const userData = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-user-'))
```

Create `e2e/external.spec.ts`:

```ts
import { rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { newPage } from './helpers'

test('pages added, renamed and deleted in Finder show up in the sidebar', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Anchor')
  await writeFile(join(workspace, 'From Finder.md'), 'Hello\n')
  await expect(page.getByTestId('sidebar-row-From Finder')).toBeVisible()
  await rename(join(workspace, 'From Finder.md'), join(workspace, 'Renamed in Finder.md'))
  await expect(page.getByTestId('sidebar-row-Renamed in Finder')).toBeVisible()
  await expect(page.getByTestId('sidebar-row-From Finder')).toHaveCount(0)
  await unlink(join(workspace, 'Renamed in Finder.md'))
  await expect(page.getByTestId('sidebar-row-Renamed in Finder')).toHaveCount(0)
})

test('a notes folder that disappears while open shows the locate screen', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Anything')
  await rm(workspace, { recursive: true, force: true })
  await expect(page.getByRole('heading', { name: "Can't find your notes" })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Locate folder' })).toBeVisible()
})
```

Create `e2e/helpers.ts`:

```ts
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { expect } from './fixtures'

export const editor = '.bn-editor'

/** Waits until the freshly created page is showing, so typing can't land in the previous one. */
export async function typeNewPageTitle(page: Page, title: string): Promise<void> {
  const heading = page.getByTestId('page-title')
  await expect(heading).toHaveText('')
  await expect(heading).toBeFocused()
  await page.keyboard.type(title)
}

export async function waitForFile(path: string, match: RegExp | string): Promise<string> {
  let text = ''
  await expect
    .poll(async () => {
      text = await readFile(path, 'utf8').catch(() => '')
      return typeof match === 'string' ? text.includes(match) : match.test(text)
    })
    .toBe(true)
  return text
}

/** Creates a top-level page with a title and leaves the cursor in its body. */
export async function newPage(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, title)
  await expect(page.getByTestId(`sidebar-row-${title}`)).toBeVisible()
  await page.keyboard.press('Enter')
}

export async function rowAction(page: Page, title: string, action: string): Promise<void> {
  const row = page.getByTestId(`sidebar-row-${title}`)
  await row.hover()
  await row.getByRole('button', { name: 'Page actions' }).click()
  await page.getByRole('button', { name: action, exact: true }).click()
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec electron-vite build && pnpm exec playwright test e2e/external.spec.ts`
Expected: both tests fail: the page created in Finder never appears in the sidebar, and the locate screen never shows.

- [ ] **Step 3: Write the implementation**

Until Task 8 adds the changed-outside banner, the editor saves with `force: true`, as plan 1 did; the version it replaces is still snapshotted to history.

Replace the whole of `src/main/handlers.ts` with:

```ts
import { BrowserWindow, dialog, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { TreeSnapshot } from '../shared/ipc'
import type { WorkspaceInfo } from '../shared/types'
import { handle, send } from './ipc'
import type { SettingsStore } from './settings'
import { exists } from './workspace/fs-utils'
import { watchWorkspace, type WorkspaceWatcher } from './workspace/watcher'
import { Workspace } from './workspace/workspace'

export interface AppContext {
  settings: SettingsStore
  workspace: Workspace | null
  watcher: WorkspaceWatcher | null
  window: () => BrowserWindow | null
}

export function workspaceInfo(ws: Workspace): WorkspaceInfo {
  return { root: ws.root, name: basename(ws.root) }
}

export function snapshot(ws: Workspace): TreeSnapshot {
  return { pages: ws.tree(), favorites: ws.favorites() }
}

export async function openWorkspace(ctx: AppContext, root: string): Promise<WorkspaceInfo> {
  await closeWorkspace(ctx)
  const ws = await Workspace.open(root)
  ctx.workspace = ws
  await ctx.settings.set({ lastWorkspace: root })
  ws.onEvent((event) => {
    const win = ctx.window()
    if (!win || ctx.workspace !== ws) return
    if (event.type === 'tree') send(win.webContents, 'tree:changed', snapshot(ws))
    else send(win.webContents, 'page:changed', { id: event.id, revision: event.revision })
  })
  const lost = async (): Promise<void> => {
    if (ctx.workspace !== ws || (await exists(root))) return
    await closeWorkspace(ctx)
    const win = ctx.window()
    if (win) send(win.webContents, 'workspace:missing', undefined)
  }
  ctx.watcher = watchWorkspace(
    root,
    (changes) => {
      if (changes.some((c) => c.kind === 'unlinkDir' && c.path === '')) void lost()
      else void ws.reconcile(changes).catch((err) => console.error('Reconcile failed', err))
    },
    () => void lost()
  )
  void ws.indexContent()
  // Housekeeping can wait until the window is up.
  setTimeout(() => {
    void ws.maintain().catch((err) => console.error('Workspace maintenance failed', err))
  }, 1000)
  return workspaceInfo(ws)
}

export async function closeWorkspace(ctx: AppContext): Promise<void> {
  const { watcher, workspace } = ctx
  ctx.watcher = null
  ctx.workspace = null
  await watcher?.close()
  await workspace?.checkpoint().catch(() => {})
  workspace?.close()
}

export function registerHandlers(ctx: AppContext): void {
  const ws = (): Workspace => {
    if (!ctx.workspace) throw new Error('No workspace is open')
    return ctx.workspace
  }
  const changed = (): void => {
    const win = ctx.window()
    if (win && ctx.workspace) send(win.webContents, 'tree:changed', snapshot(ctx.workspace))
  }
  const mutate =
    <P, R>(fn: (w: Workspace, p: P) => Promise<R>) =>
    async (p: P): Promise<R> => {
      const result = await fn(ws(), p)
      changed()
      return result
    }

  handle('workspace:current', () => (ctx.workspace ? workspaceInfo(ctx.workspace) : null))
  handle('workspace:choose', async () => {
    const win = ctx.window()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a folder for your notes',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return openWorkspace(ctx, result.filePaths[0])
  })
  handle('tree:get', () => snapshot(ws()))
  handle('page:read', ({ id }) => ws().readPage(id))
  handle('page:write', ({ id, blocks, revision, force }) =>
    ws().writePage(id, blocks, { revision, force })
  )
  handle(
    'page:meta',
    mutate((w, { id, patch }) => w.updateMeta(id, patch))
  )
  handle(
    'page:create',
    mutate((w, { parentId, index }) => w.createPage(parentId, index))
  )
  handle(
    'page:rename',
    mutate((w, { id, title }) => w.renamePage(id, title))
  )
  handle(
    'page:move',
    mutate((w, { id, parentId, index }) => w.movePage(id, parentId, index))
  )
  handle(
    'page:trash',
    mutate((w, { id }) => w.trashPage(id))
  )
  handle(
    'page:duplicate',
    mutate((w, { id }) => w.duplicatePage(id))
  )
  handle(
    'page:favorite',
    mutate((w, { id, favorite }) => w.setFavorite(id, favorite))
  )
  handle('search:query', ({ query }) => ws().search(query))
  handle('trash:list', () => ws().listTrash())
  handle('trash:read', ({ entry }) => ws().readTrash(entry))
  handle(
    'trash:restore',
    mutate((w, { entry }) => w.restoreTrash(entry))
  )
  handle('trash:delete', ({ entry }) => ws().deleteTrash(entry))
  handle('history:list', ({ id }) => ws().listHistory(id))
  handle('history:read', ({ id, version }) => ws().readHistory(id, version))
  handle(
    'history:restore',
    mutate((w, { id, version }) => w.restoreHistory(id, version))
  )
  handle('history:checkpoint', ({ id }) => ws().checkpoint(id))
  handle('history:draft', ({ id, blocks }) => ws().keepDraft(id, blocks))
  handle('attachment:save', ({ name, data }) => ws().saveAttachment(name, data))
  handle('attachment:chooseImage', async () => {
    const win = ctx.window()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const file = result.filePaths[0]
    return ws().saveAttachment(basename(file), new Uint8Array(await readFile(file)))
  })
  handle('attachment:open', async ({ href }) => {
    const file = ws().resolveAsset(href)
    if (file) await shell.openPath(file)
  })
  handle('settings:get', () => ctx.settings.get())
  handle('settings:set', (patch) => ctx.settings.set(patch))
  handle('shell:openExternal', async ({ url }) => {
    if (/^(https?|mailto):/i.test(url)) await shell.openExternal(url)
  })
}
```

Apply this change to `src/main/index.ts`:

```diff
@@ -1,7 +1,6 @@
 import {
   app,
   BrowserWindow,
-  dialog,
   ipcMain,
   Menu,
   nativeTheme,
@@ -37,6 +36,7 @@ app.on('before-quit', () => {
 const ctx: AppContext = {
   settings: new SettingsStore(join(app.getPath('userData'), 'settings.json')),
   workspace: null,
+  watcher: null,
   window: () => mainWindow
 }
 
@@ -97,7 +97,10 @@ function createWindow(): void {
     const finish = (): void => {
       if (flushed) return
       flushed = true
-      void saving.then(() => (quitting ? app.quit() : win.close()))
+      void saving
+        .then(() => ctx.workspace?.checkpoint())
+        .catch(() => {})
+        .then(() => (quitting ? app.quit() : win.close()))
     }
     ipcMain.removeHandler('app:flushed')
     ipcMain.handle('app:flushed', () => finish())
@@ -113,17 +116,6 @@ function createWindow(): void {
   else void win.loadFile(join(__dirname, '../renderer/index.html'))
 }
 
-async function chooseWorkspaceFromMenu(): Promise<void> {
-  const win = mainWindow
-  if (!win) return
-  const result = await dialog.showOpenDialog(win, {
-    properties: ['openDirectory', 'createDirectory']
-  })
-  if (result.canceled || !result.filePaths[0]) return
-  await openWorkspace(ctx, result.filePaths[0])
-  win.webContents.reload()
-}
-
 app.whenReady().then(async () => {
   const settings = await ctx.settings.load()
   if (settings.lastWorkspace) {
@@ -142,12 +134,7 @@ app.whenReady().then(async () => {
   })
 
   registerHandlers(ctx)
-  Menu.setApplicationMenu(
-    buildMenu(
-      () => mainWindow,
-      () => void chooseWorkspaceFromMenu()
-    )
-  )
+  Menu.setApplicationMenu(buildMenu(() => mainWindow))
   createWindow()
 
   app.on('activate', () => {
```

Apply this change to `src/main/menu.ts`:

```diff
@@ -2,10 +2,7 @@ import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from '
 import type { MenuCommand } from '../shared/ipc'
 import { send } from './ipc'
 
-export function buildMenu(
-  getWindow: () => BrowserWindow | null,
-  chooseWorkspace: () => void
-): Menu {
+export function buildMenu(getWindow: () => BrowserWindow | null): Menu {
   const command = (cmd: MenuCommand) => (): void => {
     const win = getWindow()
     if (win) send(win.webContents, 'menu:command', cmd)
@@ -16,7 +13,7 @@ export function buildMenu(
       label: 'File',
       submenu: [
         { label: 'New Page', accelerator: 'CmdOrCtrl+N', click: command('new-page') },
-        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: chooseWorkspace },
+        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: command('open-folder') },
         { type: 'separator' },
         { role: 'close' }
       ]
@@ -41,6 +38,8 @@ export function buildMenu(
     {
       label: 'Go',
       submenu: [
+        { label: 'Search…', accelerator: 'CmdOrCtrl+P', click: command('search') },
+        { type: 'separator' },
         { label: 'Back', accelerator: 'CmdOrCtrl+[', click: command('back') },
         { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: command('forward') }
       ]
```

Apply this change to `src/main/settings.ts`:

```diff
@@ -8,7 +8,9 @@ export const DEFAULT_SETTINGS: Settings = {
   sidebarWidth: 240,
   sidebarCollapsed: false,
   expanded: {},
-  lastPage: {}
+  lastPage: {},
+  recent: {},
+  lastColor: { kind: 'background', color: 'yellow' }
 }
 
 export class SettingsStore {
```

Apply this change to `src/renderer/src/App.tsx`:

```diff
@@ -1,6 +1,6 @@
 import { useEffect } from 'react'
-import { Sidebar } from './components/Sidebar'
 import { PageView } from './components/PageView'
+import { Sidebar } from './components/Sidebar'
 import { Welcome } from './components/Welcome'
 import { toggledPreference, useEffectiveTheme } from './lib/theme'
 import { flushAll, useApp } from './store'
@@ -20,9 +20,11 @@ export function App(): React.JSX.Element | null {
     const offFlush = api.on('app:flush', () => {
       void flushAll().finally(() => api.invoke('app:flushed', undefined))
     })
+    const offMissing = api.on('workspace:missing', () => useApp.getState().workspaceMissing())
     return () => {
       offTree()
       offFlush()
+      offMissing()
     }
   }, [])
 
@@ -31,6 +33,7 @@ export function App(): React.JSX.Element | null {
       api.on('menu:command', (cmd) => {
         const app = useApp.getState()
         if (cmd === 'new-page') void app.createPage(null)
+        if (cmd === 'open-folder') void app.chooseWorkspace()
         if (cmd === 'back') app.back()
         if (cmd === 'forward') app.forward()
         if (cmd === 'toggle-sidebar')
```

Apply this change to `src/renderer/src/components/PageEditor.tsx`:

```diff
@@ -31,8 +31,9 @@ export function PageEditor({
     timer.current = null
     const blocks = pending.current
     pending.current = null
-    if (blocks) await api.invoke('page:write', { id: doc.id, blocks })
-  }, [doc.id])
+    if (blocks)
+      await api.invoke('page:write', { id: doc.id, blocks, revision: doc.revision, force: true })
+  }, [doc.id, doc.revision])
 
   useEffect(() => {
     const unregister = registerFlusher(flush)
```

Apply this change to `src/renderer/src/store.ts`:

```diff
@@ -37,6 +37,7 @@ interface AppState {
   renamePage: (id: string, title: string) => Promise<void>
   movePage: (id: string, parentId: string | null, index: number) => Promise<void>
   trashPage: (id: string) => Promise<void>
+  workspaceMissing: () => void
   toggleFavorite: (id: string) => Promise<void>
   updateSettings: (patch: Partial<Settings>) => Promise<void>
   setExpanded: (id: string, open: boolean) => Promise<void>
@@ -72,6 +73,8 @@ export const useApp = create<AppState>((set, get) => ({
   },
 
   chooseWorkspace: async () => {
+    // Pending edits must land in the workspace they belong to.
+    await flushAll()
     const workspace = await api.invoke('workspace:choose', undefined)
     if (!workspace) return
     set({ workspace, currentId: null, history: [], historyIndex: -1 })
@@ -139,6 +142,8 @@ export const useApp = create<AppState>((set, get) => ({
     await api.invoke('page:trash', { id }).catch((e) => get().reportError('delete', e))
   },
 
+  workspaceMissing: () => set({ workspace: null, currentId: null, tree: [] }),
+
   toggleFavorite: async (id) => {
     await api
       .invoke('page:favorite', { id, favorite: !get().favorites.includes(id) })
```

Apply this change to `src/shared/ipc.ts`:

```diff
@@ -1,5 +1,14 @@
 import type { Block } from './core/blocks'
-import type { PageDoc, PageMetaPatch, PageNode, WorkspaceInfo } from './types'
+import type {
+  HistoryVersion,
+  PageDoc,
+  PageMetaPatch,
+  PageNode,
+  SearchHit,
+  TrashItem,
+  WorkspaceInfo,
+  WriteResult
+} from './types'
 
 export type ThemePreference = 'system' | 'light' | 'dark'
 
@@ -14,26 +23,47 @@ export interface Settings {
   /** Workspace root -> id of the page open when the app last closed. */
   lastPage: Record<string, string>
   windowBounds?: { x: number; y: number; width: number; height: number }
+  /** Workspace root -> ids of recently opened pages, newest first. */
+  recent: Record<string, string[]>
+  /** The color Cmd+Shift+H applies: the last one picked in the formatting toolbar. */
+  lastColor: { kind: 'text' | 'background'; color: string }
 }
 
+export const RECENT_LIMIT = 20
+
 export interface TreeSnapshot {
   pages: PageNode[]
   favorites: string[]
 }
 
-export type MenuCommand = 'new-page' | 'toggle-sidebar' | 'toggle-theme' | 'back' | 'forward'
+export type MenuCommand =
+  'new-page' | 'open-folder' | 'search' | 'toggle-sidebar' | 'toggle-theme' | 'back' | 'forward'
 
 export interface IpcContract {
   'workspace:current': [payload: void, result: WorkspaceInfo | null]
   'workspace:choose': [payload: void, result: WorkspaceInfo | null]
   'tree:get': [payload: void, result: TreeSnapshot]
   'page:read': [payload: { id: string }, result: PageDoc]
-  'page:write': [payload: { id: string; blocks: Block[] }, result: void]
+  'page:write': [
+    payload: { id: string; blocks: Block[]; revision: number; force?: boolean },
+    result: WriteResult
+  ]
   'page:meta': [payload: { id: string; patch: PageMetaPatch }, result: void]
   'page:create': [payload: { parentId: string | null; index?: number }, result: PageNode]
   'page:rename': [payload: { id: string; title: string }, result: void]
   'page:move': [payload: { id: string; parentId: string | null; index: number }, result: void]
   'page:trash': [payload: { id: string }, result: void]
+  'page:duplicate': [payload: { id: string }, result: PageNode]
+  'search:query': [payload: { query: string }, result: SearchHit[]]
+  'trash:list': [payload: void, result: TrashItem[]]
+  'trash:read': [payload: { entry: string }, result: PageDoc]
+  'trash:restore': [payload: { entry: string }, result: string]
+  'trash:delete': [payload: { entry: string }, result: void]
+  'history:list': [payload: { id: string }, result: HistoryVersion[]]
+  'history:read': [payload: { id: string; version: string }, result: PageDoc]
+  'history:restore': [payload: { id: string; version: string }, result: void]
+  'history:checkpoint': [payload: { id: string }, result: void]
+  'history:draft': [payload: { id: string; blocks: Block[] }, result: void]
   'page:favorite': [payload: { id: string; favorite: boolean }, result: void]
   'attachment:save': [payload: { name: string; data: Uint8Array }, result: string]
   'attachment:chooseImage': [payload: void, result: string | null]
@@ -50,6 +80,8 @@ export type IpcResult<C extends IpcChannel> = IpcContract[C][1]
 
 export interface IpcEvents {
   'tree:changed': TreeSnapshot
+  'page:changed': { id: string; revision: number }
+  'workspace:missing': void
   'menu:command': MenuCommand
   'app:flush': void
 }
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: 156 unit tests and 15 end-to-end tests pass.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add e2e/app.spec.ts e2e/external.spec.ts e2e/helpers.ts src/main/handlers.ts src/main/index.ts src/main/menu.ts src/main/settings.ts src/renderer/src/App.tsx src/renderer/src/components/PageEditor.tsx src/renderer/src/store.ts src/shared/ipc.ts
git commit -m "Wire the watcher, search, trash and history into the main process"
```


---

### Task 6: Search modal and Move to

Cmd+K, Cmd+P or "Search" in the sidebar opens Notion's search modal: recent pages before typing, then results with parent pages and a highlighted snippet, driven by the keyboard.
Cmd+K with text selected in the editor still adds a link, because the link button handles it first and marks the event handled.
The same modal, given a page id, is the "Move to" picker in the sidebar page menu, which also gets icons for Rename and Move to.

**Files:**
- Create: `src/renderer/src/components/Modal.tsx`, `src/renderer/src/components/SearchModal.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/SidebarRow.tsx`, `src/renderer/src/components/icons.tsx`, `src/renderer/src/store.ts`, `src/renderer/src/styles/app.css`, `src/renderer/src/styles/tokens.css`
- Test: `e2e/pages.spec.ts`, `e2e/search.spec.ts`

**Interfaces:**
- Consumes: `search:query`, `Settings.recent`, `findRanges` (Task 1), `movePage` from plan 1.
- Produces: `type Overlay = { kind: 'search' } | { kind: 'move'; pageId: string } | { kind: 'history'; pageId: string }`; store `overlay`, `setOverlay(overlay)`; `openPage` records recents; `Modal({ onClose, className?, label, children })`; `SearchModal({ moving?: string })`; icons `SearchIcon`, `MoveIcon`, `RenameIcon`; CSS token `--backdrop`.

- [ ] **Step 1: Write the failing tests**

Create `e2e/pages.spec.ts`:

```ts
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { rowAction } from './helpers'

test('move to picks a new parent from a searchable list', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Inbox.md'), 'Note\n')
  await writeFile(join(nb.workspace, 'Projects.md'), 'All projects\n')
  await writeFile(join(nb.workspace, 'Archive.md'), 'Old\n')
  const page = await nb.relaunch()
  await rowAction(page, 'Inbox', 'Move to')
  const picker = page.getByRole('dialog', { name: 'Move page to' })
  await expect(picker.locator('.search-item-title')).toHaveText([
    'Top level',
    'Archive',
    'Projects'
  ])
  await picker.getByRole('textbox').fill('proj')
  await expect(picker.locator('.search-item-title')).toHaveText(['Projects'])
  await page.keyboard.press('Enter')
  await expect
    .poll(() => readdir(join(nb.workspace, 'Projects')).catch(() => []))
    .toEqual(['Inbox.md'])
})
```

Create `e2e/search.spec.ts`:

```ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor } from './helpers'

test('search shows recent pages, ranks title matches first and opens with the keyboard', async ({
  nb
}) => {
  await writeFile(join(nb.workspace, 'Groceries.md'), 'Apples and a website notebook.\n')
  await writeFile(join(nb.workspace, 'Website Redesign.md'), 'Plan the launch.\n')
  await writeFile(join(nb.workspace, 'Reading list.md'), 'Books.\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Reading list').click()
  await page.getByTestId('sidebar-row-Groceries').click()

  await page.keyboard.press('Meta+k')
  const dialog = page.getByRole('dialog', { name: 'Search' })
  const titles = dialog.locator('.search-item-title')
  await expect(dialog.locator('.search-section')).toHaveText('Recent')
  await expect(titles).toHaveText(['Groceries', 'Reading list'])

  await dialog.getByRole('textbox').fill('website')
  // Content is indexed in the background shortly after the workspace opens.
  await expect(titles).toHaveText(['Website Redesign', 'Groceries'])
  await expect(dialog.locator('.search-item-snippet').first()).toHaveText(
    'Apples and a website notebook.'
  )
  await expect(dialog.locator('.search-hit').first()).toHaveText('Website')

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('page-title')).toHaveText('Groceries')

  await nb.app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Search…')
      ?.click()
  )
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('Cmd+K on selected text adds a link instead of opening search', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Note.md'), 'Link this word.\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Note').click()
  await page.locator(editor).getByText('Link this word.').dblclick()
  await page.keyboard.press('Meta+k')
  await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0)
  await expect(page.getByPlaceholder('Edit URL')).toBeVisible()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec electron-vite build && pnpm exec playwright test e2e/search.spec.ts e2e/pages.spec.ts`
Expected: the search and "move to" tests fail (no Search dialog; no "Move to" menu item).
"Cmd+K on selected text adds a link instead of opening search" already passes: it guards the link shortcut against the search shortcut added here.

- [ ] **Step 3: Write the implementation**

Apply this change to `src/renderer/src/App.tsx`:

```diff
@@ -1,5 +1,6 @@
 import { useEffect } from 'react'
 import { PageView } from './components/PageView'
+import { SearchModal } from './components/SearchModal'
 import { Sidebar } from './components/Sidebar'
 import { Welcome } from './components/Welcome'
 import { toggledPreference, useEffectiveTheme } from './lib/theme'
@@ -13,6 +14,7 @@ export function App(): React.JSX.Element | null {
   const settings = useApp((s) => s.settings)
   const theme = useEffectiveTheme(settings?.theme)
   const error = useApp((s) => s.error)
+  const overlay = useApp((s) => s.overlay)
 
   useEffect(() => {
     void useApp.getState().init()
@@ -21,10 +23,19 @@ export function App(): React.JSX.Element | null {
       void flushAll().finally(() => api.invoke('app:flushed', undefined))
     })
     const offMissing = api.on('workspace:missing', () => useApp.getState().workspaceMissing())
+    // Cmd+K opens search unless the editor used it to add a link to selected text.
+    const onKey = (e: KeyboardEvent): void => {
+      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'k') return
+      if (e.defaultPrevented || !useApp.getState().workspace) return
+      e.preventDefault()
+      useApp.getState().setOverlay({ kind: 'search' })
+    }
+    window.addEventListener('keydown', onKey)
     return () => {
       offTree()
       offFlush()
       offMissing()
+      window.removeEventListener('keydown', onKey)
     }
   }, [])
 
@@ -34,6 +45,7 @@ export function App(): React.JSX.Element | null {
         const app = useApp.getState()
         if (cmd === 'new-page') void app.createPage(null)
         if (cmd === 'open-folder') void app.chooseWorkspace()
+        if (cmd === 'search' && app.workspace) app.setOverlay({ kind: 'search' })
         if (cmd === 'back') app.back()
         if (cmd === 'forward') app.forward()
         if (cmd === 'toggle-sidebar')
@@ -52,6 +64,8 @@ export function App(): React.JSX.Element | null {
         <>
           {!settings?.sidebarCollapsed && <Sidebar />}
           <PageView theme={theme} />
+          {overlay?.kind === 'search' && <SearchModal />}
+          {overlay?.kind === 'move' && <SearchModal moving={overlay.pageId} />}
         </>
       )}
       {error && (
```

Create `src/renderer/src/components/Modal.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A dimmed backdrop with a panel; closes on backdrop click and Escape. */
export function Modal({
  onClose,
  className,
  label,
  children
}: {
  onClose: () => void
  className?: string
  label: string
  children: ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className ?? ''}`} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body
  )
}
```

Create `src/renderer/src/components/SearchModal.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { findRanges } from '@shared/core/text'
import type { PageNode, SearchHit, TextRange } from '@shared/types'
import { findNode, pathTo } from '../lib/tree'
import { useApp } from '../store'
import { SearchIcon } from './icons'
import { Modal } from './Modal'
import { PageIconView } from './PageIconView'

const api = window.api
const MAX_ITEMS = 50
// Selectors must return stable references, or zustand re-renders forever.
const NONE: string[] = []

interface Item {
  /** null is the top level, offered by the Move to picker. */
  id: string | null
  title: string
  icon?: string
  titleRanges: TextRange[]
  crumbs: string
  snippet: { text: string; ranges: TextRange[] } | null
}

function itemOf(tree: PageNode[], node: PageNode, titleRanges: TextRange[] = []): Item {
  const crumbs = pathTo(tree, node.id)
    .slice(0, -1)
    .map((n) => n.title || 'Untitled')
    .join(' / ')
  return {
    id: node.id,
    title: node.title || 'Untitled',
    icon: node.icon,
    titleRanges,
    crumbs,
    snippet: null
  }
}

/** Ranges of every query term in `title`, or null unless all of them occur. */
function titleMatch(title: string, terms: string[]): TextRange[] | null {
  if (terms.some((t) => findRanges(title, [t]).length === 0)) return null
  return findRanges(title, terms)
}

/** Pages a page can be moved under: everything except itself and its sub-pages. */
function moveTargets(tree: PageNode[], moving: string, terms: string[]): Item[] {
  const out: Item[] = []
  const top = titleMatch('Top level', terms)
  if (top) out.push({ id: null, title: 'Top level', titleRanges: top, crumbs: '', snippet: null })
  const walk = (nodes: PageNode[]): void => {
    for (const n of nodes) {
      if (n.id === moving) continue
      const ranges = titleMatch(n.title || 'Untitled', terms)
      if (ranges) out.push(itemOf(tree, n, ranges))
      walk(n.children)
    }
  }
  walk(tree)
  return out.slice(0, MAX_ITEMS)
}

/** Cmd+K search, or the "Move to" picker when `moving` is a page id. */
export function SearchModal({ moving }: { moving?: string }): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const workspace = useApp((s) => s.workspace)
  const recent = useApp((s) => (s.workspace && s.settings?.recent[s.workspace.root]) || NONE)
  const close = (): void => useApp.getState().setOverlay(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [selected, setSelected] = useState(0)
  const seq = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (moving || query.trim() === '') return
    const mine = ++seq.current
    void api.invoke('search:query', { query }).then((results) => {
      if (mine === seq.current) setHits(results)
    })
  }, [query, moving])

  const items = useMemo((): Item[] => {
    const terms = query.trim().split(/\s+/).filter(Boolean)
    if (moving) return moveTargets(tree, moving, terms)
    const ids = terms.length ? hits.map((h) => h.id) : recent
    return ids.flatMap((id, i) => {
      const node = findNode(tree, id)
      if (!node) return []
      const hit = terms.length ? hits[i] : null
      return [{ ...itemOf(tree, node, hit?.titleRanges), snippet: hit?.snippet ?? null }]
    })
  }, [moving, query, hits, tree, recent])

  useEffect(() => {
    listRef.current?.querySelector('.search-item.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const choose = (item: Item | undefined): void => {
    if (!item) return
    close()
    const app = useApp.getState()
    if (!moving) {
      if (item.id) app.openPage(item.id)
      return
    }
    const siblings = item.id ? (findNode(app.tree, item.id)?.children ?? []) : app.tree
    void app.movePage(moving, item.id, siblings.filter((n) => n.id !== moving).length)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      choose(items[selected])
    }
  }

  const searching = query.trim() !== ''
  return (
    <Modal onClose={close} className="search" label={moving ? 'Move page to' : 'Search'}>
      <div className="search-input-row">
        <SearchIcon size={18} />
        <input
          className="search-input"
          autoFocus
          placeholder={moving ? 'Move page to…' : `Search ${workspace?.name ?? ''}…`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="search-results" ref={listRef}>
        {!moving && !searching && items.length > 0 && <div className="search-section">Recent</div>}
        {items.map((item, i) => (
          <button
            key={item.id ?? 'top'}
            className={`search-item ${i === selected ? 'selected' : ''}`}
            onMouseMove={() => i !== selected && setSelected(i)}
            onClick={() => choose(item)}
          >
            <span className="page-icon">
              {item.id === null ? (
                <span className="sidebar-workspace-badge">
                  {workspace?.name.slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <PageIconView icon={item.icon} />
              )}
            </span>
            <span className="search-item-body">
              <span className="search-item-line">
                <span className="search-item-title">
                  <Highlighted text={item.title} ranges={item.titleRanges} />
                </span>
                {item.crumbs && <span className="search-item-crumbs">{item.crumbs}</span>}
              </span>
              {item.snippet && (
                <span className="search-item-snippet">
                  <Highlighted text={item.snippet.text} ranges={item.snippet.ranges} />
                </span>
              )}
            </span>
          </button>
        ))}
        {items.length === 0 && (
          <div className="search-empty">
            {searching ? 'No results' : moving ? 'No pages' : 'Pages you open will show up here'}
          </div>
        )}
      </div>
      <div className="search-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Select
        </span>
        <span>
          <kbd>↵</kbd> {moving ? 'Move' : 'Open'}
        </span>
        <span>
          <kbd>esc</kbd> Close
        </span>
      </div>
    </Modal>
  )
}

function Highlighted({ text, ranges }: { text: string; ranges: TextRange[] }): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <mark key={start} className="search-hit">
        {text.slice(start, end)}
      </mark>
    )
    at = end
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}
```

Apply this change to `src/renderer/src/components/Sidebar.tsx`:

```diff
@@ -1,7 +1,7 @@
 import { useState } from 'react'
 import { findNode } from '../lib/tree'
 import { useApp } from '../store'
-import { ComposeIcon, PlusIcon, SidebarIcon } from './icons'
+import { ComposeIcon, PlusIcon, SearchIcon, SidebarIcon } from './icons'
 import { Menu } from './Popover'
 import { SidebarRow } from './SidebarRow'
 
@@ -64,6 +64,14 @@ export function Sidebar(): React.JSX.Element {
         <span className="sidebar-workspace-badge">{workspace?.name.slice(0, 1).toUpperCase()}</span>
         <span className="sidebar-row-title">{workspace?.name}</span>
       </button>
+      <div className="sidebar-nav">
+        <button className="sidebar-row" onClick={() => app().setOverlay({ kind: 'search' })}>
+          <span className="page-icon">
+            <SearchIcon size={18} />
+          </span>
+          <span className="sidebar-row-title">Search</span>
+        </button>
+      </div>
       <div className="sidebar-scroll">
         {favoriteNodes.length > 0 && (
           <div className="sidebar-section">
```

Apply this change to `src/renderer/src/components/SidebarRow.tsx`:

```diff
@@ -2,7 +2,15 @@ import { useState, type DragEvent } from 'react'
 import type { PageNode } from '@shared/types'
 import { dropTarget, type DropPosition } from '../lib/tree'
 import { useApp } from '../store'
-import { ChevronRightIcon, DotsIcon, PlusIcon, StarIcon, TrashIcon } from './icons'
+import {
+  ChevronRightIcon,
+  DotsIcon,
+  MoveIcon,
+  PlusIcon,
+  RenameIcon,
+  StarIcon,
+  TrashIcon
+} from './icons'
 import { Menu } from './Popover'
 import { PageIconView } from './PageIconView'
 
@@ -128,7 +136,17 @@ export function SidebarRow({
               icon: <StarIcon size={16} filled={isFavorite} />,
               onSelect: () => void app().toggleFavorite(node.id)
             },
-            { label: 'Rename', onSelect: () => app().setRenaming(node.id) },
+            'separator',
+            {
+              label: 'Rename',
+              icon: <RenameIcon size={16} />,
+              onSelect: () => app().setRenaming(node.id)
+            },
+            {
+              label: 'Move to',
+              icon: <MoveIcon size={16} />,
+              onSelect: () => app().setOverlay({ kind: 'move', pageId: node.id })
+            },
             'separator',
             {
               label: 'Delete',
```

Apply this change to `src/renderer/src/components/icons.tsx`:

```diff
@@ -139,3 +139,31 @@ export const TrashIcon = (p: IconProps): React.JSX.Element => (
     />
   </Svg>
 )
+
+const stroke = {
+  fill: 'none',
+  stroke: 'currentColor',
+  strokeWidth: 1.5,
+  strokeLinecap: 'round',
+  strokeLinejoin: 'round'
+} as const
+
+export const SearchIcon = (p: IconProps): React.JSX.Element => (
+  <Svg {...p}>
+    <circle cx="8.75" cy="8.75" r="5" {...stroke} />
+    <path d="m12.5 12.5 4 4" {...stroke} />
+  </Svg>
+)
+
+export const MoveIcon = (p: IconProps): React.JSX.Element => (
+  <Svg {...p}>
+    <path d="M4.25 4.5v4.25a3 3 0 0 0 3 3h9" {...stroke} />
+    <path d="m13 8.25 3.25 3.5L13 15.25" {...stroke} />
+  </Svg>
+)
+
+export const RenameIcon = (p: IconProps): React.JSX.Element => (
+  <Svg {...p}>
+    <path d="M12.75 4.25 15.75 7.25 7.5 15.5H4.5v-3l8.25-8.25Z" {...stroke} />
+  </Svg>
+)
```

Apply this change to `src/renderer/src/store.ts`:

```diff
@@ -1,5 +1,5 @@
 import { create } from 'zustand'
-import type { Settings, TreeSnapshot } from '@shared/ipc'
+import { RECENT_LIMIT, type Settings, type TreeSnapshot } from '@shared/ipc'
 import type { PageNode, WorkspaceInfo } from '@shared/types'
 import { findNode, firstPageId } from './lib/tree'
 
@@ -15,6 +15,9 @@ export async function flushAll(): Promise<void> {
   await Promise.all([...flushers].map((fn) => fn()))
 }
 
+export type Overlay =
+  { kind: 'search' } | { kind: 'move'; pageId: string } | { kind: 'history'; pageId: string }
+
 interface AppState {
   ready: boolean
   workspace: WorkspaceInfo | null
@@ -26,6 +29,7 @@ interface AppState {
   historyIndex: number
   renamingId: string | null
   error: string | null
+  overlay: Overlay | null
 
   init: () => Promise<void>
   chooseWorkspace: () => Promise<void>
@@ -37,6 +41,7 @@ interface AppState {
   renamePage: (id: string, title: string) => Promise<void>
   movePage: (id: string, parentId: string | null, index: number) => Promise<void>
   trashPage: (id: string) => Promise<void>
+  setOverlay: (overlay: Overlay | null) => void
   workspaceMissing: () => void
   toggleFavorite: (id: string) => Promise<void>
   updateSettings: (patch: Partial<Settings>) => Promise<void>
@@ -56,6 +61,7 @@ export const useApp = create<AppState>((set, get) => ({
   historyIndex: -1,
   renamingId: null,
   error: null,
+  overlay: null,
 
   init: async () => {
     const [settings, workspace] = await Promise.all([
@@ -77,7 +83,7 @@ export const useApp = create<AppState>((set, get) => ({
     await flushAll()
     const workspace = await api.invoke('workspace:choose', undefined)
     if (!workspace) return
-    set({ workspace, currentId: null, history: [], historyIndex: -1 })
+    set({ workspace, currentId: null, history: [], historyIndex: -1, overlay: null })
     get().applySnapshot(await api.invoke('tree:get', undefined))
     const start = firstPageId(get().tree) ?? (await get().createPage(null))
     get().openPage(start)
@@ -99,7 +105,11 @@ export const useApp = create<AppState>((set, get) => ({
     const nextHistory = [...history.slice(0, historyIndex + 1), id]
     set({ currentId: id, history: nextHistory, historyIndex: nextHistory.length - 1 })
     if (workspace && settings) {
-      void get().updateSettings({ lastPage: { ...settings.lastPage, [workspace.root]: id } })
+      const recent = [id, ...(settings.recent[workspace.root] ?? []).filter((r) => r !== id)]
+      void get().updateSettings({
+        lastPage: { ...settings.lastPage, [workspace.root]: id },
+        recent: { ...settings.recent, [workspace.root]: recent.slice(0, RECENT_LIMIT) }
+      })
     }
   },
 
@@ -142,7 +152,9 @@ export const useApp = create<AppState>((set, get) => ({
     await api.invoke('page:trash', { id }).catch((e) => get().reportError('delete', e))
   },
 
-  workspaceMissing: () => set({ workspace: null, currentId: null, tree: [] }),
+  setOverlay: (overlay) => set({ overlay }),
+
+  workspaceMissing: () => set({ workspace: null, currentId: null, overlay: null, tree: [] }),
 
   toggleFavorite: async (id) => {
     await api
```

Apply this change to `src/renderer/src/styles/app.css`:

```diff
@@ -539,3 +539,160 @@ button {
   font-size: 14px;
   z-index: 200;
 }
+
+/* ---------- sidebar search and trash ---------- */
+.sidebar-nav {
+  padding: 4px 8px 0;
+  flex: none;
+}
+.sidebar-nav .sidebar-row,
+.sidebar-footer .sidebar-row {
+  padding-left: 6px;
+  font-weight: 500;
+}
+.sidebar-nav .page-icon,
+.sidebar-footer .page-icon {
+  color: var(--text-tertiary);
+}
+
+/* ---------- modals ---------- */
+.modal-backdrop {
+  position: fixed;
+  inset: 0;
+  z-index: 150;
+  background: var(--backdrop);
+  display: flex;
+  align-items: flex-start;
+  justify-content: center;
+}
+.modal {
+  margin-top: 12vh;
+  background: var(--menu-bg);
+  box-shadow: var(--menu-shadow);
+  border-radius: 12px;
+  color: var(--text);
+  overflow: hidden;
+}
+
+/* ---------- search ---------- */
+.modal.search {
+  width: min(755px, calc(100vw - 48px));
+  max-height: min(560px, 76vh);
+  display: flex;
+  flex-direction: column;
+}
+.search-input-row {
+  display: flex;
+  align-items: center;
+  gap: 10px;
+  height: 52px;
+  padding: 0 16px;
+  border-bottom: 1px solid var(--divider);
+  color: var(--text-tertiary);
+  flex: none;
+}
+.search-input {
+  flex: 1;
+  border: none;
+  outline: none;
+  background: none;
+  color: var(--text);
+  font: inherit;
+  font-size: 16px;
+}
+.search-input::placeholder {
+  color: var(--text-tertiary);
+}
+.search-results {
+  flex: 1;
+  overflow-y: auto;
+  padding: 6px;
+}
+.search-section {
+  font-size: 12px;
+  font-weight: 500;
+  color: var(--text-tertiary);
+  padding: 6px 8px 4px;
+}
+.search-item {
+  display: flex;
+  align-items: flex-start;
+  gap: 8px;
+  width: 100%;
+  padding: 6px 8px;
+  border-radius: 6px;
+  text-align: left;
+}
+.search-item.selected {
+  background: var(--hover);
+}
+.search-item .page-icon {
+  margin-top: -1px;
+}
+.search-item-body {
+  flex: 1;
+  min-width: 0;
+  display: flex;
+  flex-direction: column;
+  gap: 2px;
+}
+.search-item-line {
+  display: flex;
+  align-items: baseline;
+  gap: 8px;
+  min-width: 0;
+  line-height: 20px;
+}
+.search-item-title {
+  font-weight: 500;
+  white-space: nowrap;
+  overflow: hidden;
+  text-overflow: ellipsis;
+  flex: none;
+  max-width: 60%;
+}
+.search-item-crumbs {
+  font-size: 12px;
+  color: var(--text-tertiary);
+  white-space: nowrap;
+  overflow: hidden;
+  text-overflow: ellipsis;
+  min-width: 0;
+}
+.search-item-snippet {
+  font-size: 12px;
+  line-height: 18px;
+  color: var(--text-secondary);
+  white-space: nowrap;
+  overflow: hidden;
+  text-overflow: ellipsis;
+}
+.search-hit {
+  background: none;
+  color: var(--text);
+  font-weight: 600;
+}
+.search-empty {
+  padding: 28px 8px;
+  text-align: center;
+  color: var(--text-tertiary);
+}
+.search-footer {
+  display: flex;
+  gap: 16px;
+  padding: 8px 16px;
+  border-top: 1px solid var(--divider);
+  font-size: 12px;
+  color: var(--text-tertiary);
+  flex: none;
+}
+.search-footer kbd {
+  display: inline-block;
+  min-width: 18px;
+  margin-right: 2px;
+  padding: 0 4px;
+  border: 1px solid var(--divider);
+  border-radius: 4px;
+  font: inherit;
+  text-align: center;
+}
```

Apply this change to `src/renderer/src/styles/tokens.css`:

```diff
@@ -21,6 +21,7 @@
     rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 3px 6px,
     rgba(15, 15, 15, 0.2) 0 9px 24px;
   --drop-line: rgba(35, 131, 226, 0.6);
+  --backdrop: rgba(15, 15, 15, 0.6);
 
   --color-gray: #787774;
   --color-brown: #9f6b53;
@@ -59,6 +60,7 @@
   --hover-strong: rgba(255, 255, 255, 0.09);
   --selected: rgba(35, 131, 226, 0.2);
   --menu-bg: #252525;
+  --backdrop: rgba(0, 0, 0, 0.6);
   --menu-shadow:
     rgba(15, 15, 15, 0.1) 0 0 0 1px, rgba(15, 15, 15, 0.2) 0 3px 6px,
     rgba(15, 15, 15, 0.4) 0 9px 24px;
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: 156 unit tests and 18 end-to-end tests pass.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add e2e/pages.spec.ts e2e/search.spec.ts src/renderer/src/App.tsx src/renderer/src/components/Modal.tsx src/renderer/src/components/SearchModal.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/SidebarRow.tsx src/renderer/src/components/icons.tsx src/renderer/src/store.ts src/renderer/src/styles/app.css src/renderer/src/styles/tokens.css
git commit -m "Add Cmd+K search with recent pages, and Move to"
```


---

### Task 7: Trash panel

"Trash" at the bottom of the sidebar opens Notion's popover: a filter box and the deleted pages, each with Restore and Delete forever.
Clicking one shows the page read-only under a red "This page is in Trash." banner; Delete forever always asks first.
This task also adds the shared pieces the History panel reuses: the read-only page, the banner, the confirm dialog, and the editor's `editable` prop.

**Files:**
- Create: `src/renderer/src/components/Banner.tsx`, `src/renderer/src/components/ReadOnlyPage.tsx`, `src/renderer/src/components/TrashPopover.tsx`, `src/renderer/src/components/TrashedPageView.tsx`, `src/renderer/src/lib/pageLink.ts`, `src/renderer/src/lib/time.ts`, `src/renderer/src/lib/trash.ts`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/Modal.tsx`, `src/renderer/src/components/Popover.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/icons.tsx`, `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/store.ts`, `src/renderer/src/styles/app.css`, `src/renderer/src/styles/tokens.css`
- Test: `e2e/trash.spec.ts`, `src/renderer/src/lib/time.test.ts`

**Interfaces:**
- Consumes: `trash:list|read|restore|delete` (Task 5).
- Produces: store `trashEntry`, `showTrashEntry(entry | null)`, `restoreTrash(entry)`, `deleteTrash(entry)`; `Banner({ tone: 'danger' | 'warning' | 'info', message, actions? })`; `ConfirmDialog({ title, message?, confirmLabel, danger?, onConfirm, onClose })`; `ReadOnlyPage({ doc, theme })`; `TrashPopover`, `TrashedPageView`; `Popover` prop `side?: 'below' | 'right'` (it also re-places itself when its content resizes); `versionLabel(iso, now?)`, `timeAgo(iso, now?)`, `deleteForeverTitle(item)`, `usePageLink()`; `Editor` prop `editable?: boolean`; `RestoreIcon`; tokens `--danger`, `--danger-hover`, `--input-bg`.

- [ ] **Step 1: Write the failing tests**

Create `e2e/trash.spec.ts`:

```ts
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, rowAction } from './helpers'

test('a deleted page opens read-only from Trash and can be restored', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Plans.md'), '---\nicon: 🗂️\n---\n\nKeep this safe.\n')
  await mkdir(join(nb.workspace, 'Plans'))
  await writeFile(join(nb.workspace, 'Plans', 'Child.md'), 'Inner.\n')
  await writeFile(join(nb.workspace, 'Other.md'), 'Other page.\n')
  const page = await nb.relaunch()
  await rowAction(page, 'Plans', 'Delete')
  await expect(page.getByTestId('sidebar-row-Plans')).toHaveCount(0)

  await page.getByRole('button', { name: 'Trash' }).click()
  const item = page.getByTestId('trash-item-Plans')
  await expect(item).toContainText('Top level')
  await item.click()
  await expect(page.getByRole('status')).toContainText('This page is in Trash.')
  await expect(page.locator(editor)).toContainText('Keep this safe.')
  await expect(page.locator(editor)).toHaveAttribute('contenteditable', 'false')

  await page.getByRole('button', { name: 'Restore page' }).click()
  await expect(page.getByTestId('sidebar-row-Plans')).toBeVisible()
  await expect(page.getByTestId('page-title')).toHaveText('Plans')
  expect(await readdir(join(nb.workspace, 'Plans'))).toEqual(['Child.md'])
  expect(await readdir(join(nb.workspace, '.nobsidian', 'trash'))).toEqual([])
})

test('delete forever asks first, then removes the page for good', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Scratch.md'), 'Temporary.\n')
  await writeFile(join(nb.workspace, 'Other.md'), 'Other page.\n')
  const page = await nb.relaunch()
  await rowAction(page, 'Scratch', 'Delete')
  await page.getByRole('button', { name: 'Trash' }).click()
  await page
    .getByTestId('trash-item-Scratch')
    .getByRole('button', { name: 'Delete forever' })
    .click()
  const confirm = page.getByRole('dialog', { name: 'Permanently delete "Scratch"?' })
  await expect(confirm).toContainText("This can't be undone.")
  await confirm.getByRole('button', { name: 'Delete forever' }).click()
  await expect.poll(() => readdir(join(nb.workspace, '.nobsidian', 'trash'))).toEqual([])
  await page.getByRole('button', { name: 'Trash' }).click()
  await expect(page.getByText('No pages in Trash')).toBeVisible()
})
```

Create `src/renderer/src/lib/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { timeAgo, versionLabel } from './time'

const now = new Date(2026, 9, 21, 15, 0)
const at = (...args: [number, number, number, number, number]): string =>
  new Date(...args).toISOString()

describe('versionLabel', () => {
  it('names today and yesterday, and drops the year only within this year', () => {
    expect(versionLabel(at(2026, 9, 21, 14, 3), now)).toBe('Today, 2:03 PM')
    expect(versionLabel(at(2026, 9, 20, 9, 12), now)).toBe('Yesterday, 9:12 AM')
    expect(versionLabel(at(2026, 9, 12, 9, 12), now)).toBe('Oct 12, 9:12 AM')
    expect(versionLabel(at(2025, 11, 31, 23, 59), now)).toBe('Dec 31, 2025, 11:59 PM')
  })
})

describe('timeAgo', () => {
  it('counts minutes, hours and calendar days', () => {
    expect(timeAgo(at(2026, 9, 21, 14, 59), now)).toBe('1 minute ago')
    expect(timeAgo(now.toISOString(), now)).toBe('Just now')
    expect(timeAgo(at(2026, 9, 21, 14, 20), now)).toBe('40 minutes ago')
    expect(timeAgo(at(2026, 9, 21, 12, 0), now)).toBe('3 hours ago')
    expect(timeAgo(at(2026, 9, 20, 9, 0), now)).toBe('Yesterday')
    expect(timeAgo(at(2026, 9, 17, 9, 0), now)).toBe('4 days ago')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run src/renderer && pnpm exec electron-vite build && pnpm exec playwright test e2e/trash.spec.ts`
Expected: FAIL. `time.test.ts` cannot import `./time`; both trash tests fail (no "Trash" button).

- [ ] **Step 3: Write the implementation**

Apply this change to `src/renderer/src/App.tsx`:

```diff
@@ -2,6 +2,7 @@ import { useEffect } from 'react'
 import { PageView } from './components/PageView'
 import { SearchModal } from './components/SearchModal'
 import { Sidebar } from './components/Sidebar'
+import { TrashedPageView } from './components/TrashedPageView'
 import { Welcome } from './components/Welcome'
 import { toggledPreference, useEffectiveTheme } from './lib/theme'
 import { flushAll, useApp } from './store'
@@ -15,6 +16,7 @@ export function App(): React.JSX.Element | null {
   const theme = useEffectiveTheme(settings?.theme)
   const error = useApp((s) => s.error)
   const overlay = useApp((s) => s.overlay)
+  const trashEntry = useApp((s) => s.trashEntry)
 
   useEffect(() => {
     void useApp.getState().init()
@@ -63,7 +65,11 @@ export function App(): React.JSX.Element | null {
       ) : (
         <>
           {!settings?.sidebarCollapsed && <Sidebar />}
-          <PageView theme={theme} />
+          {trashEntry ? (
+            <TrashedPageView key={trashEntry} entry={trashEntry} theme={theme} />
+          ) : (
+            <PageView theme={theme} />
+          )}
           {overlay?.kind === 'search' && <SearchModal />}
           {overlay?.kind === 'move' && <SearchModal moving={overlay.pageId} />}
         </>
```

Create `src/renderer/src/components/Banner.tsx`:

```tsx
/** A full-width notice under the top bar: page in Trash, changed outside the app, bad frontmatter. */
export function Banner({
  tone,
  message,
  actions = []
}: {
  tone: 'danger' | 'warning' | 'info'
  message: string
  actions?: { label: string; onClick: () => void }[]
}): React.JSX.Element {
  return (
    <div className={`banner banner-${tone}`} role="status">
      <span>{message}</span>
      {actions.map((a) => (
        <button key={a.label} className="banner-button" onClick={a.onClick}>
          {a.label}
        </button>
      ))}
    </div>
  )
}
```

Replace the whole of `src/renderer/src/components/Modal.tsx` with:

```tsx
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** A dimmed backdrop with a panel; closes on backdrop click and Escape. */
export function Modal({
  onClose,
  className,
  label,
  children
}: {
  onClose: () => void
  className?: string
  label: string
  children: ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className ?? ''}`} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body
  )
}

/** A small "are you sure" dialog with a destructive or primary confirm button. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose
}: {
  title: string
  message?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal onClose={onClose} className="confirm" label={title}>
      <div className="confirm-title">{title}</div>
      {message && <div className="confirm-message">{message}</div>}
      <div className="confirm-actions">
        <button
          className={danger ? 'button-danger' : 'button-primary'}
          autoFocus
          onClick={() => {
            onClose()
            onConfirm()
          }}
        >
          {confirmLabel}
        </button>
        <button className="button-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
```

Apply this change to `src/renderer/src/components/Popover.tsx`:

```diff
@@ -4,6 +4,8 @@ import { createPortal } from 'react-dom'
 export interface PopoverProps {
   anchor: DOMRect
   align?: 'start' | 'end'
+  /** Below the anchor (default), or beside it to the right, bottom-aligned. */
+  side?: 'below' | 'right'
   onClose: () => void
   children: ReactNode
   className?: string
@@ -13,6 +15,7 @@ export interface PopoverProps {
 export function Popover({
   anchor,
   align = 'start',
+  side = 'below',
   onClose,
   children,
   className
@@ -20,16 +23,33 @@ export function Popover({
   const ref = useRef<HTMLDivElement>(null)
   const [pos, setPos] = useState({ top: anchor.bottom + 4, left: anchor.left })
 
+  // Re-placed whenever the content changes size, e.g. a list that loads after opening.
+  const [size, setSize] = useState({ width: 0, height: 0 })
+  useLayoutEffect(() => {
+    const el = ref.current
+    if (!el) return
+    const observer = new ResizeObserver(() =>
+      setSize({ width: el.offsetWidth, height: el.offsetHeight })
+    )
+    observer.observe(el)
+    return () => observer.disconnect()
+  }, [])
+
   useLayoutEffect(() => {
     const el = ref.current
     if (!el) return
     const { width, height } = el.getBoundingClientRect()
+    if (side === 'right') {
+      const left = Math.min(anchor.right + 6, window.innerWidth - width - 8)
+      setPos({ top: Math.max(8, Math.min(anchor.bottom, window.innerHeight - 8) - height), left })
+      return
+    }
     let left = align === 'end' ? anchor.right - width : anchor.left
     let top = anchor.bottom + 4
     left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
     if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 4)
     setPos({ top, left })
-  }, [anchor, align])
+  }, [anchor, align, side, size])
 
   useEffect(() => {
     const onDown = (e: MouseEvent): void => {
```

Create `src/renderer/src/components/ReadOnlyPage.tsx`:

```tsx
import { useMemo } from 'react'
import { codeBlockOptions } from '@blocknote/code-block'
import { decodeHref } from '@shared/core/paths'
import type { PageDoc } from '@shared/types'
import { Editor } from '../editor/Editor'
import { createLanguageResolver, withEditorLanguages } from '../editor/codeLanguages'
import type { AppPartialBlock } from '../editor/schema'
import { resolveAssetUrl } from '../lib/assets'
import { openHref } from '../lib/navigation'
import { usePageLink } from '../lib/pageLink'
import { PageIconView } from './PageIconView'

const editorLanguage = createLanguageResolver(codeBlockOptions.supportedLanguages)

// Links to pages that are not in the workspace (deleted sub-pages) have nowhere to go.
const openLink = (href: string): void => {
  if (!/\.md$/i.test(decodeHref(href))) openHref(href)
}

/** A page shown as it is (a trashed page or an old version); nothing on it can be edited. */
export function ReadOnlyPage({
  doc,
  theme
}: {
  doc: PageDoc
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const pageLink = usePageLink()
  const blocks = useMemo(
    () => withEditorLanguages(doc.blocks, editorLanguage) as unknown as AppPartialBlock[],
    [doc.blocks]
  )
  const width = doc.meta.fullWidth ? 'full-width' : ''
  return (
    <div className="read-only-page">
      {doc.meta.cover && (
        <div className="page-cover">
          <img
            src={resolveAssetUrl(doc.meta.cover)}
            alt=""
            draggable={false}
            style={{ objectPosition: `center ${doc.meta.coverPosition ?? 50}%` }}
          />
        </div>
      )}
      <div className={`page-column ${width}`}>
        <div className={`page-header ${doc.meta.cover ? 'has-cover' : ''}`}>
          {doc.meta.icon && (
            <div className="page-header-icon static">
              <PageIconView icon={doc.meta.icon} size={78} />
            </div>
          )}
          {/* Keeps the gap the editable page's hover controls take. */}
          <div className="page-header-controls" aria-hidden />
          <h1 className="page-title static">{doc.title || 'Untitled'}</h1>
        </div>
      </div>
      <div className={`page-column page-body ${width}`}>
        <Editor
          initialBlocks={blocks}
          theme={theme}
          editable={false}
          onChange={() => {}}
          uploadFile={async () => ''}
          resolveFileUrl={async (url) => resolveAssetUrl(url)}
          createSubPage={async () => ''}
          openLink={openLink}
          pageLink={{ ...pageLink, open: openLink }}
        />
      </div>
    </div>
  )
}
```

Apply this change to `src/renderer/src/components/Sidebar.tsx`:

```diff
@@ -1,9 +1,13 @@
 import { useState } from 'react'
+import type { TrashItem } from '@shared/types'
 import { findNode } from '../lib/tree'
+import { deleteForeverTitle } from '../lib/trash'
 import { useApp } from '../store'
-import { ComposeIcon, PlusIcon, SearchIcon, SidebarIcon } from './icons'
+import { ComposeIcon, PlusIcon, SearchIcon, SidebarIcon, TrashIcon } from './icons'
+import { ConfirmDialog } from './Modal'
 import { Menu } from './Popover'
 import { SidebarRow } from './SidebarRow'
+import { TrashPopover } from './TrashPopover'
 
 const MIN_WIDTH = 200
 const MAX_WIDTH = 480
@@ -15,6 +19,8 @@ export function Sidebar(): React.JSX.Element {
   const savedWidth = useApp((s) => s.settings?.sidebarWidth ?? 240)
   const [width, setWidth] = useState<number | null>(null)
   const [menu, setMenu] = useState<DOMRect | null>(null)
+  const [trash, setTrash] = useState<DOMRect | null>(null)
+  const [deleting, setDeleting] = useState<TrashItem | null>(null)
   const app = useApp.getState
 
   const startResize = (e: React.MouseEvent): void => {
@@ -100,7 +106,31 @@ export function Sidebar(): React.JSX.Element {
           </button>
         </div>
       </div>
+      <div className="sidebar-footer">
+        <button
+          className={`sidebar-row ${trash ? 'menu-open' : ''}`}
+          onClick={(e) => setTrash(e.currentTarget.getBoundingClientRect())}
+        >
+          <span className="page-icon">
+            <TrashIcon size={18} />
+          </span>
+          <span className="sidebar-row-title">Trash</span>
+        </button>
+      </div>
       <div className="sidebar-resize" onMouseDown={startResize} />
+      {trash && (
+        <TrashPopover anchor={trash} onClose={() => setTrash(null)} onDeleteForever={setDeleting} />
+      )}
+      {deleting && (
+        <ConfirmDialog
+          title={deleteForeverTitle(deleting)}
+          message="This can't be undone."
+          confirmLabel="Delete forever"
+          danger
+          onConfirm={() => void app().deleteTrash(deleting.entry)}
+          onClose={() => setDeleting(null)}
+        />
+      )}
       {menu && (
         <Menu
           anchor={menu}
```

Create `src/renderer/src/components/TrashPopover.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { findRanges } from '@shared/core/text'
import type { TrashItem } from '@shared/types'
import { timeAgo } from '../lib/time'
import { useApp } from '../store'
import { RestoreIcon, SearchIcon, TrashIcon } from './icons'
import { PageIconView } from './PageIconView'
import { Popover } from './Popover'

const api = window.api

/** Notion's Trash: deleted pages, filterable, each restorable or deletable for good. */
export function TrashPopover({
  anchor,
  onClose,
  onDeleteForever
}: {
  anchor: DOMRect
  onClose: () => void
  onDeleteForever: (item: TrashItem) => void
}): React.JSX.Element {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [query, setQuery] = useState('')
  const app = useApp.getState

  useEffect(() => {
    void api.invoke('trash:list', undefined).then(setItems)
  }, [])

  const terms = query.trim().split(/\s+/).filter(Boolean)
  const shown = (items ?? []).filter((item) =>
    terms.every((t) => findRanges(item.title || 'Untitled', [t]).length > 0)
  )

  return (
    <Popover anchor={anchor} onClose={onClose} className="trash-popover" side="right">
      <div className="trash-search">
        <SearchIcon size={16} />
        <input
          autoFocus
          placeholder="Search pages in Trash"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="trash-list">
        {shown.map((item) => (
          <div
            key={item.entry}
            className="trash-item"
            role="button"
            data-testid={`trash-item-${item.title || 'Untitled'}`}
            onClick={() => {
              onClose()
              app().showTrashEntry(item.entry)
            }}
          >
            <span className="page-icon">
              <PageIconView icon={item.icon} />
            </span>
            <span className="trash-item-body">
              <span className="trash-item-title">{item.title || 'Untitled'}</span>
              <span className="trash-item-meta">
                {item.parentTitle ?? 'Top level'} · {timeAgo(item.deletedAt)}
              </span>
            </span>
            <button
              className="icon-button"
              aria-label="Restore"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
                void app().restoreTrash(item.entry)
              }}
            >
              <RestoreIcon size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Delete forever"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
                onDeleteForever(item)
              }}
            >
              <TrashIcon size={16} />
            </button>
          </div>
        ))}
        {items && shown.length === 0 && (
          <div className="trash-empty">{items.length ? 'No matches' : 'No pages in Trash'}</div>
        )}
      </div>
      <div className="trash-footer">Pages in Trash for over 30 days are deleted automatically.</div>
    </Popover>
  )
}
```

Create `src/renderer/src/components/TrashedPageView.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { PageDoc, TrashItem } from '@shared/types'
import { useApp } from '../store'
import { Banner } from './Banner'
import { ConfirmDialog } from './Modal'
import { PageIconView } from './PageIconView'
import { ReadOnlyPage } from './ReadOnlyPage'
import { deleteForeverTitle } from '../lib/trash'

const api = window.api

/** A deleted page, read-only, under a banner offering Restore and Delete forever. */
export function TrashedPageView({
  entry,
  theme
}: {
  entry: string
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const [doc, setDoc] = useState<PageDoc | null>(null)
  const [item, setItem] = useState<TrashItem | null>(null)
  const [confirming, setConfirming] = useState(false)
  const app = useApp.getState

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      api.invoke('trash:read', { entry }),
      api.invoke('trash:list', undefined)
    ]).then(([d, items]) => {
      if (cancelled) return
      setDoc(d)
      setItem(items.find((i) => i.entry === entry) ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [entry])

  return (
    <div className="main">
      <header className="topbar drag-region">
        <div className="breadcrumbs no-drag">
          {doc && (
            <span className="breadcrumb">
              {doc.meta.icon && (
                <span className="page-icon">
                  <PageIconView icon={doc.meta.icon} size={14} />
                </span>
              )}
              {doc.title || 'Untitled'}
            </span>
          )}
        </div>
      </header>
      <Banner
        tone="danger"
        message="This page is in Trash."
        actions={[
          { label: 'Restore page', onClick: () => void app().restoreTrash(entry) },
          { label: 'Delete from Trash', onClick: () => setConfirming(true) }
        ]}
      />
      <div className="page-scroll">{doc && <ReadOnlyPage doc={doc} theme={theme} />}</div>
      {confirming && (
        <ConfirmDialog
          title={deleteForeverTitle(item ?? { title: doc?.title ?? '', pageCount: 1 })}
          message="This can't be undone."
          confirmLabel="Delete forever"
          danger
          onConfirm={() => void app().deleteTrash(entry)}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
```

Apply this change to `src/renderer/src/components/icons.tsx`:

```diff
@@ -167,3 +167,10 @@ export const RenameIcon = (p: IconProps): React.JSX.Element => (
     <path d="M12.75 4.25 15.75 7.25 7.5 15.5H4.5v-3l8.25-8.25Z" {...stroke} />
   </Svg>
 )
+
+export const RestoreIcon = (p: IconProps): React.JSX.Element => (
+  <Svg {...p}>
+    <path d="M5 8.25h7.25a3.75 3.75 0 0 1 0 7.5H9" {...stroke} />
+    <path d="M7.75 5.5 5 8.25 7.75 11" {...stroke} />
+  </Svg>
+)
```

Apply this change to `src/renderer/src/editor/Editor.tsx`:

```diff
@@ -41,6 +41,7 @@ export type EditorProps = {
   createSubPage(): Promise<string>
   openLink(href: string): void
   pageLink: PageLinkContextValue
+  editable?: boolean
 }
 
 const OpenLinkContext = createContext<(href: string) => void>(() => {})
@@ -114,6 +115,7 @@ export function Editor(props: EditorProps): React.JSX.Element {
         <BlockNoteView
           editor={editor}
           theme={props.theme}
+          editable={props.editable !== false}
           slashMenu={false}
           formattingToolbar={false}
           linkToolbar={false}
```

Create `src/renderer/src/lib/pageLink.ts`:

```ts
import { useMemo } from 'react'
import { pageIdFromHref } from '@shared/core/links'
import type { PageLinkContextValue } from '../editor/schema'
import { useApp } from '../store'
import { openHref } from './navigation'
import { findNode } from './tree'

export function usePageLink(): PageLinkContextValue {
  const tree = useApp((s) => s.tree)
  return useMemo(
    () => ({
      resolve: (href) => {
        const id = pageIdFromHref(href)
        const node = id ? findNode(tree, id) : null
        return node ? { title: node.title || 'Untitled', icon: node.icon } : null
      },
      open: openHref
    }),
    [tree]
  )
}
```

Create `src/renderer/src/lib/time.ts`:

```ts
const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "Today, 2:03 PM", "Yesterday, 9:12 AM", "Oct 12, 9:12 AM", or with the year if not this year. */
export function versionLabel(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  const sameYear = date.getFullYear() === now.getFullYear()
  const day = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })
  return `${day}, ${time}`
}

/** "Just now", "5 minutes ago", "3 hours ago", "Yesterday", "4 days ago". */
export function timeAgo(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY_MS)
  return days <= 1 ? 'Yesterday' : `${days} days ago`
}
```

Create `src/renderer/src/lib/trash.ts`:

```ts
import type { TrashItem } from '@shared/types'

export function deleteForeverTitle(item: Pick<TrashItem, 'title' | 'pageCount'>): string {
  const subPages = item.pageCount - 1
  const name = item.title || 'Untitled'
  return subPages === 0
    ? `Permanently delete "${name}"?`
    : `Permanently delete "${name}" and its ${subPages} sub-page${subPages === 1 ? '' : 's'}?`
}
```

Apply this change to `src/renderer/src/store.ts`:

```diff
@@ -30,6 +30,8 @@ interface AppState {
   renamingId: string | null
   error: string | null
   overlay: Overlay | null
+  /** Trash entry whose page is shown read-only instead of the current page. */
+  trashEntry: string | null
 
   init: () => Promise<void>
   chooseWorkspace: () => Promise<void>
@@ -41,6 +43,9 @@ interface AppState {
   renamePage: (id: string, title: string) => Promise<void>
   movePage: (id: string, parentId: string | null, index: number) => Promise<void>
   trashPage: (id: string) => Promise<void>
+  showTrashEntry: (entry: string | null) => void
+  restoreTrash: (entry: string) => Promise<void>
+  deleteTrash: (entry: string) => Promise<void>
   setOverlay: (overlay: Overlay | null) => void
   workspaceMissing: () => void
   toggleFavorite: (id: string) => Promise<void>
@@ -62,6 +67,7 @@ export const useApp = create<AppState>((set, get) => ({
   renamingId: null,
   error: null,
   overlay: null,
+  trashEntry: null,
 
   init: async () => {
     const [settings, workspace] = await Promise.all([
@@ -83,7 +89,14 @@ export const useApp = create<AppState>((set, get) => ({
     await flushAll()
     const workspace = await api.invoke('workspace:choose', undefined)
     if (!workspace) return
-    set({ workspace, currentId: null, history: [], historyIndex: -1, overlay: null })
+    set({
+      workspace,
+      currentId: null,
+      history: [],
+      historyIndex: -1,
+      overlay: null,
+      trashEntry: null
+    })
     get().applySnapshot(await api.invoke('tree:get', undefined))
     const start = firstPageId(get().tree) ?? (await get().createPage(null))
     get().openPage(start)
@@ -100,7 +113,8 @@ export const useApp = create<AppState>((set, get) => ({
   },
 
   openPage: (id) => {
-    const { history, historyIndex, currentId, workspace, settings } = get()
+    const { history, historyIndex, currentId, workspace, settings, trashEntry } = get()
+    if (trashEntry) set({ trashEntry: null })
     if (id === currentId) return
     const nextHistory = [...history.slice(0, historyIndex + 1), id]
     set({ currentId: id, history: nextHistory, historyIndex: nextHistory.length - 1 })
@@ -152,9 +166,31 @@ export const useApp = create<AppState>((set, get) => ({
     await api.invoke('page:trash', { id }).catch((e) => get().reportError('delete', e))
   },
 
+  showTrashEntry: (entry) => set({ trashEntry: entry }),
+
+  restoreTrash: async (entry) => {
+    try {
+      const id = await api.invoke('trash:restore', { entry })
+      set({ trashEntry: null })
+      get().openPage(id)
+    } catch (e) {
+      await get().reportError('restore', e)
+    }
+  },
+
+  deleteTrash: async (entry) => {
+    try {
+      await api.invoke('trash:delete', { entry })
+      if (get().trashEntry === entry) set({ trashEntry: null })
+    } catch (e) {
+      await get().reportError('delete', e)
+    }
+  },
+
   setOverlay: (overlay) => set({ overlay }),
 
-  workspaceMissing: () => set({ workspace: null, currentId: null, overlay: null, tree: [] }),
+  workspaceMissing: () =>
+    set({ workspace: null, currentId: null, trashEntry: null, overlay: null, tree: [] }),
 
   toggleFavorite: async (id) => {
     await api
```

Apply this change to `src/renderer/src/styles/app.css`:

```diff
@@ -696,3 +696,192 @@ button {
   font: inherit;
   text-align: center;
 }
+
+/* ---------- buttons ---------- */
+.button-primary:disabled {
+  opacity: 0.4;
+  cursor: default;
+  background: var(--accent);
+}
+.button-danger {
+  background: var(--danger);
+  color: #fff;
+  border-radius: 6px;
+  padding: 8px 14px;
+  font-weight: 500;
+}
+.button-danger:hover {
+  background: var(--danger-hover);
+}
+.button-secondary {
+  border: 1px solid var(--divider);
+  border-radius: 6px;
+  padding: 7px 14px;
+  font-weight: 500;
+}
+.button-secondary:hover {
+  background: var(--hover);
+}
+
+/* ---------- sidebar trash ---------- */
+.sidebar-footer {
+  padding: 4px 8px 8px;
+  flex: none;
+}
+.sidebar-footer .sidebar-row.menu-open {
+  background: var(--hover);
+}
+
+/* ---------- confirm dialogs ---------- */
+.modal.confirm {
+  margin-top: 30vh;
+  width: 320px;
+  padding: 20px;
+  text-align: center;
+}
+.confirm-title {
+  font-size: 14px;
+  font-weight: 500;
+  line-height: 1.4;
+}
+.confirm-message {
+  font-size: 13px;
+  color: var(--text-secondary);
+  margin-top: 6px;
+}
+.confirm-actions {
+  display: flex;
+  flex-direction: column;
+  gap: 8px;
+  margin-top: 18px;
+}
+
+/* ---------- banners ---------- */
+.banner {
+  display: flex;
+  align-items: center;
+  justify-content: center;
+  gap: 10px;
+  min-height: 44px;
+  padding: 6px 16px;
+  font-size: 14px;
+  flex: none;
+}
+.banner-button {
+  height: 28px;
+  padding: 0 10px;
+  border-radius: 4px;
+  font-weight: 500;
+}
+.banner-danger {
+  background: var(--danger);
+  color: #fff;
+}
+.banner-danger .banner-button {
+  border: 1px solid rgba(255, 255, 255, 0.8);
+}
+.banner-danger .banner-button:hover {
+  background: rgba(255, 255, 255, 0.15);
+}
+.banner-warning {
+  background: var(--bg-yellow);
+}
+.banner-info {
+  background: var(--bg-gray);
+  color: var(--text-secondary);
+}
+.banner-warning .banner-button {
+  border: 1px solid var(--divider);
+  background: var(--bg);
+}
+.banner-warning .banner-button:hover {
+  background: var(--hover);
+}
+
+/* ---------- read-only pages ---------- */
+.page-header-icon.static,
+.page-header-icon.static:hover {
+  cursor: default;
+  background: none;
+}
+.page-title.static {
+  cursor: default;
+}
+
+/* ---------- trash ---------- */
+.menu.trash-popover {
+  width: 414px;
+  max-height: min(520px, 70vh);
+  display: flex;
+  flex-direction: column;
+  padding: 0;
+}
+.trash-search {
+  display: flex;
+  align-items: center;
+  gap: 6px;
+  margin: 10px 10px 6px;
+  padding: 0 8px;
+  height: 30px;
+  border-radius: 6px;
+  background: var(--input-bg);
+  box-shadow: inset 0 0 0 1px var(--divider);
+  color: var(--text-tertiary);
+  flex: none;
+}
+.trash-search input {
+  flex: 1;
+  border: none;
+  outline: none;
+  background: none;
+  font: inherit;
+  color: var(--text);
+}
+.trash-list {
+  flex: 1;
+  overflow-y: auto;
+  padding: 0 4px 4px;
+}
+.trash-item {
+  display: flex;
+  align-items: center;
+  gap: 8px;
+  padding: 4px 6px;
+  border-radius: 6px;
+  cursor: pointer;
+}
+.trash-item:hover {
+  background: var(--hover);
+}
+.trash-item-body {
+  flex: 1;
+  min-width: 0;
+  display: flex;
+  flex-direction: column;
+}
+.trash-item-title,
+.trash-item-meta {
+  white-space: nowrap;
+  overflow: hidden;
+  text-overflow: ellipsis;
+}
+.trash-item-meta {
+  font-size: 12px;
+  color: var(--text-tertiary);
+}
+.trash-item .icon-button {
+  width: 26px;
+  height: 26px;
+}
+.trash-empty {
+  padding: 24px 8px;
+  text-align: center;
+  color: var(--text-tertiary);
+}
+.trash-footer {
+  padding: 8px 12px;
+  border-top: 1px solid var(--divider);
+  font-size: 12px;
+  color: var(--text-tertiary);
+  flex: none;
+}
```

Apply this change to `src/renderer/src/styles/tokens.css`:

```diff
@@ -22,6 +22,9 @@
     rgba(15, 15, 15, 0.2) 0 9px 24px;
   --drop-line: rgba(35, 131, 226, 0.6);
   --backdrop: rgba(15, 15, 15, 0.6);
+  --danger: #eb5757;
+  --danger-hover: #d84b4b;
+  --input-bg: rgba(242, 241, 238, 0.6);
 
   --color-gray: #787774;
   --color-brown: #9f6b53;
@@ -61,6 +64,9 @@
   --selected: rgba(35, 131, 226, 0.2);
   --menu-bg: #252525;
   --backdrop: rgba(0, 0, 0, 0.6);
+  --danger: #c4554d;
+  --danger-hover: #b04a43;
+  --input-bg: rgba(255, 255, 255, 0.055);
   --menu-shadow:
     rgba(15, 15, 15, 0.1) 0 0 0 1px, rgba(15, 15, 15, 0.2) 0 3px 6px,
     rgba(15, 15, 15, 0.4) 0 9px 24px;
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: 158 unit tests and 20 end-to-end tests pass.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add e2e/trash.spec.ts src/renderer/src/App.tsx src/renderer/src/components/Banner.tsx src/renderer/src/components/Modal.tsx src/renderer/src/components/Popover.tsx src/renderer/src/components/ReadOnlyPage.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/components/TrashPopover.tsx src/renderer/src/components/TrashedPageView.tsx src/renderer/src/components/icons.tsx src/renderer/src/editor/Editor.tsx src/renderer/src/lib/pageLink.ts src/renderer/src/lib/time.test.ts src/renderer/src/lib/time.ts src/renderer/src/lib/trash.ts src/renderer/src/store.ts src/renderer/src/styles/app.css src/renderer/src/styles/tokens.css
git commit -m "Add the Trash panel with restore, delete forever and a read-only preview"
```


---

### Task 8: Page history and the changed-outside banner

The editor now saves against the page's revision.
When the page changes outside the app it reloads silently, keeping the scroll position, unless there are unsaved edits (typed, or still being saved); then a banner offers "Reload" and "Keep mine".
Reload moves the unsaved edits into history before reloading; Keep mine saves them over the outside version, which is already in history; leaving the page without choosing keeps the outside version on disk and the edits in history.
Saves run one at a time, so each is based on the revision the previous one returned.
The top bar menu gets "Page history": a modal with a read-only preview of each version and "Restore version", after a confirmation.

**Files:**
- Create: `src/renderer/src/components/HistoryModal.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/components/PageEditor.tsx`, `src/renderer/src/components/PageView.tsx`, `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/components/icons.tsx`, `src/renderer/src/styles/app.css`
- Test: `e2e/external.spec.ts`, `e2e/history.spec.ts`

**Interfaces:**
- Consumes: `page:write` with revisions, `page:changed`, `history:list|read|restore|checkpoint|draft` (Task 5); `ReadOnlyPage`, `Banner`, `ConfirmDialog`, `versionLabel`, `usePageLink` (Task 7).
- Produces: `interface PageEditorHandle { hasUnsaved(): boolean; revision(): number; keepMine(): Promise<void>; discard(): Promise<void> }` (`PageEditor` takes `ref` and `onConflict`); `HistoryModal({ pageId, theme })`; icons `ClockIcon`, `CloseIcon`, `WidthIcon`.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `e2e/external.spec.ts` with:

```ts
import { readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, newPage, waitForFile } from './helpers'

/** The page's id line, so an outside edit keeps the page's identity like a real editor would. */
async function header(file: string): Promise<string> {
  return /^---\n[\s\S]*?\n---\n/.exec(await readFile(file, 'utf8'))![0]
}

test('an outside edit reloads the open page when nothing is unsaved', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Shared')
  await page.keyboard.type('Original')
  const file = join(workspace, 'Shared.md')
  await waitForFile(file, 'Original')
  await writeFile(file, `${await header(file)}\nEdited in another app\n`)
  await expect(page.locator(editor)).toHaveText('Edited in another app')
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('an outside edit during typing asks before replacing it, and keeps both', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Shared')
  await page.keyboard.type('Base')
  const file = join(workspace, 'Shared.md')
  await waitForFile(file, 'Base')
  const head = await header(file)
  const id = /id: (\S+)/.exec(head)![1]
  const history = async (): Promise<string[]> => {
    const dir = join(workspace, '.nobsidian', 'history', id)
    const names = (await readdir(dir).catch(() => [])).filter((v) => v.endsWith('.md'))
    return Promise.all(names.map((v) => readFile(join(dir, v), 'utf8')))
  }

  await page.keyboard.type(' plus mine')
  await writeFile(file, `${head}\nTheirs\n`)
  const banner = page.getByRole('status')
  await expect(banner).toContainText('This page was changed outside Nobsidian.')
  await expect(page.locator(editor)).toHaveText('Base plus mine')
  await banner.getByRole('button', { name: 'Keep mine' }).click()
  await expect(banner).toHaveCount(0)
  await waitForFile(file, 'Base plus mine')
  expect((await history()).some((t) => t.endsWith('\nTheirs\n'))).toBe(true)

  await page.keyboard.type(' again')
  await writeFile(file, `${head}\nTheirs again\n`)
  await banner.getByRole('button', { name: 'Reload' }).click()
  await expect(page.locator(editor)).toHaveText('Theirs again')
  await expect
    .poll(async () => (await history()).some((t) => t.includes('Base plus mine again')))
    .toBe(true)
  await page.waitForTimeout(800)
  expect(await readFile(file, 'utf8')).toContain('Theirs again')
})

test('pages added, renamed and deleted in Finder show up in the sidebar', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Anchor')
  await writeFile(join(workspace, 'From Finder.md'), 'Hello\n')
  await expect(page.getByTestId('sidebar-row-From Finder')).toBeVisible()
  await rename(join(workspace, 'From Finder.md'), join(workspace, 'Renamed in Finder.md'))
  await expect(page.getByTestId('sidebar-row-Renamed in Finder')).toBeVisible()
  await expect(page.getByTestId('sidebar-row-From Finder')).toHaveCount(0)
  await unlink(join(workspace, 'Renamed in Finder.md'))
  await expect(page.getByTestId('sidebar-row-Renamed in Finder')).toHaveCount(0)
})

test('a notes folder that disappears while open shows the locate screen', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Anything')
  await rm(workspace, { recursive: true, force: true })
  await expect(page.getByRole('heading', { name: "Can't find your notes" })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Locate folder' })).toBeVisible()
})
```

Create `e2e/history.spec.ts`:

```ts
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, newPage, waitForFile } from './helpers'

test('page history previews an older version and restores it', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Essay')
  await page.keyboard.type('First draft')
  await waitForFile(join(workspace, 'Essay.md'), 'First draft')

  const openHistory = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Page menu' }).click()
    await page.getByRole('button', { name: 'Page history' }).click()
  }
  await openHistory()
  const dialog = page.getByRole('dialog', { name: 'Page history' })
  await expect(dialog.locator('.history-item')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Close' }).click()

  await page.locator(editor).click()
  await page.keyboard.press('End')
  await page.keyboard.type(', then rewritten')
  await waitForFile(join(workspace, 'Essay.md'), 'then rewritten')
  await openHistory()
  await expect(dialog.locator('.history-item')).toHaveCount(2)
  await expect(dialog.locator('.history-item').first()).toContainText('Current')
  await expect(dialog.getByRole('button', { name: 'Restore version' })).toBeDisabled()

  await dialog.locator('.history-item').nth(1).click()
  await expect(dialog.locator('.history-preview')).toContainText('First draft')
  await expect(dialog.locator('.history-preview')).not.toContainText('rewritten')
  await dialog.getByRole('button', { name: 'Restore version' }).click()
  await page
    .getByRole('dialog', { name: /^Restore the version from/ })
    .getByRole('button', { name: 'Restore' })
    .click()

  await expect(page.locator(editor)).toHaveText('First draft')
  await waitForFile(join(workspace, 'Essay.md'), /\n\nFirst draft\n$/)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec electron-vite build && pnpm exec playwright test e2e/history.spec.ts e2e/external.spec.ts`
Expected: FAIL. No "Page history" menu item; with an outside edit during typing no banner appears.

- [ ] **Step 3: Write the implementation**

Apply this change to `src/renderer/src/App.tsx`:

```diff
@@ -1,4 +1,5 @@
 import { useEffect } from 'react'
+import { HistoryModal } from './components/HistoryModal'
 import { PageView } from './components/PageView'
 import { SearchModal } from './components/SearchModal'
 import { Sidebar } from './components/Sidebar'
@@ -72,6 +73,7 @@ export function App(): React.JSX.Element | null {
           )}
           {overlay?.kind === 'search' && <SearchModal />}
           {overlay?.kind === 'move' && <SearchModal moving={overlay.pageId} />}
+          {overlay?.kind === 'history' && <HistoryModal pageId={overlay.pageId} theme={theme} />}
         </>
       )}
       {error && (
```

Create `src/renderer/src/components/HistoryModal.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { HistoryVersion, PageDoc } from '@shared/types'
import { versionLabel } from '../lib/time'
import { flushAll, useApp } from '../store'
import { CloseIcon } from './icons'
import { ConfirmDialog, Modal } from './Modal'
import { ReadOnlyPage } from './ReadOnlyPage'

const api = window.api

/** Notion's version history: a read-only preview, the list of versions, and Restore. */
export function HistoryModal({
  pageId,
  theme
}: {
  pageId: string
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const [versions, setVersions] = useState<HistoryVersion[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ version: string; doc: PageDoc } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const seq = useRef(0)
  const close = (): void => useApp.getState().setOverlay(null)

  useEffect(() => {
    let cancelled = false
    // Saved first, so what is on screen is the newest version and restoring never loses it.
    void flushAll()
      .then(() => api.invoke('history:list', { id: pageId }))
      .then((list) => {
        if (cancelled) return
        setVersions(list)
        setSelected(list[0]?.id ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [pageId])

  useEffect(() => {
    if (!selected) return
    const mine = ++seq.current
    void api.invoke('history:read', { id: pageId, version: selected }).then((doc) => {
      if (mine === seq.current) setPreview({ version: selected, doc })
    })
  }, [pageId, selected])

  const restore = async (): Promise<void> => {
    if (!selected) return
    close()
    await api
      .invoke('history:restore', { id: pageId, version: selected })
      .catch((e) => useApp.getState().reportError('restore', e))
  }

  return (
    <Modal onClose={close} className="history" label="Page history">
      <div className="history-preview">
        {/* Keyed by the loaded version: the editor reads its content only when created. */}
        {preview && <ReadOnlyPage key={preview.version} doc={preview.doc} theme={theme} />}
        {versions?.length === 0 && (
          <div className="history-empty">
            No versions yet. Nobsidian keeps a version every 10 minutes while you edit, and when you
            leave a page.
          </div>
        )}
      </div>
      <div className="history-side">
        <div className="history-header">
          <span>Page history</span>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="history-list">
          {versions?.map((v, i) => (
            <button
              key={v.id}
              className={`history-item ${v.id === selected ? 'selected' : ''}`}
              onClick={() => setSelected(v.id)}
            >
              {versionLabel(v.at)}
              {i === 0 && <span className="history-current">Current</span>}
            </button>
          ))}
        </div>
        <div className="history-footer">
          <button
            className="button-primary"
            disabled={!selected || selected === versions?.[0]?.id}
            onClick={() => setConfirming(true)}
          >
            Restore version
          </button>
        </div>
      </div>
      {confirming && selected && versions && (
        <ConfirmDialog
          title={`Restore the version from ${versionLabel(versions.find((v) => v.id === selected)!.at)}?`}
          message="The page's current content stays in its history."
          confirmLabel="Restore"
          onConfirm={() => void restore()}
          onClose={() => setConfirming(false)}
        />
      )}
    </Modal>
  )
}
```

Replace the whole of `src/renderer/src/components/PageEditor.tsx` with:

```tsx
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react'
import type { Block } from '@shared/core/blocks'
import { pageLinkHref } from '@shared/core/links'
import { openHref } from '../lib/navigation'
import type { PageDoc } from '@shared/types'
import { codeBlockOptions } from '@blocknote/code-block'
import { Editor } from '../editor/Editor'
import { createLanguageResolver, withEditorLanguages } from '../editor/codeLanguages'
import type { AppBlock, AppPartialBlock } from '../editor/schema'
import { resolveAssetUrl } from '../lib/assets'
import { usePageLink } from '../lib/pageLink'
import { registerFlusher, useApp } from '../store'

const SAVE_DELAY_MS = 500
const editorLanguage = createLanguageResolver(codeBlockOptions.supportedLanguages)
const api = window.api

/** `auto`: the typing debounce. `leave`: the page is closing. `force`: the user chose Keep mine. */
type SaveMode = 'auto' | 'leave' | 'force'

export interface PageEditorHandle {
  /** Edits not yet on disk: typed, being saved, or held back by a conflict. */
  hasUnsaved(): boolean
  /** The file revision this editor's content is based on. */
  revision(): number
  /** Saves what is on screen over the version changed outside the app. */
  keepMine(): Promise<void>
  /** Moves unsaved edits into the page's history, before reloading the page from disk. */
  discard(): Promise<void>
}

export function PageEditor({
  doc,
  theme,
  onConflict,
  ref
}: {
  doc: PageDoc
  theme: 'light' | 'dark'
  onConflict: () => void
  ref?: Ref<PageEditorHandle>
}): React.JSX.Element {
  const pending = useRef<Block[] | null>(null)
  const latest = useRef<Block[] | null>(null)
  const revision = useRef(doc.revision)
  const conflicted = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const pageLink = usePageLink()

  const keepDraft = useCallback(
    (blocks: Block[]) => api.invoke('history:draft', { id: doc.id, blocks }),
    [doc.id]
  )

  const save = useCallback(
    async (mode: SaveMode): Promise<void> => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      // One save at a time, so each is based on the revision the previous one returned.
      while (inFlight.current) await inFlight.current
      const blocks = pending.current
      if (!blocks || (conflicted.current && mode === 'auto')) return
      pending.current = null
      const write = async (): Promise<void> => {
        // A page left during a conflict keeps the other version; these edits go to history.
        if (conflicted.current && mode === 'leave') return keepDraft(blocks)
        const result = await api.invoke('page:write', {
          id: doc.id,
          blocks,
          revision: revision.current,
          force: mode === 'force'
        })
        if (result.ok) {
          revision.current = result.revision
          conflicted.current = false
        } else if (result.reason === 'conflict') {
          conflicted.current = true
          if (mode === 'leave') return keepDraft(blocks)
          pending.current ??= blocks
          onConflict()
        }
      }
      inFlight.current = write().finally(() => {
        inFlight.current = null
      })
      await inFlight.current
    },
    [doc.id, onConflict, keepDraft]
  )

  useImperativeHandle(
    ref,
    () => ({
      hasUnsaved: () => pending.current !== null || inFlight.current !== null,
      revision: () => revision.current,
      keepMine: async () => {
        pending.current = latest.current ?? pending.current
        await save('force')
      },
      discard: async () => {
        if (timer.current) clearTimeout(timer.current)
        while (inFlight.current) await inFlight.current
        const blocks = pending.current
        pending.current = null
        conflicted.current = false
        if (blocks) await keepDraft(blocks)
      }
    }),
    [save, keepDraft]
  )

  useEffect(() => {
    const flush = (): Promise<void> => save('leave')
    const unregister = registerFlusher(flush)
    return () => {
      unregister()
      void flush().then(() => api.invoke('history:checkpoint', { id: doc.id }))
    }
  }, [save, doc.id])

  const onChange = useCallback(
    (blocks: AppBlock[]) => {
      latest.current = blocks as unknown as Block[]
      pending.current = latest.current
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save('auto'), SAVE_DELAY_MS)
    },
    [save]
  )

  const initialBlocks = useMemo(
    () => withEditorLanguages(doc.blocks, editorLanguage) as unknown as AppPartialBlock[],
    [doc.blocks]
  )

  return (
    <Editor
      initialBlocks={initialBlocks}
      theme={theme}
      onChange={onChange}
      uploadFile={async (file) =>
        api.invoke('attachment:save', {
          name: file.name,
          data: new Uint8Array(await file.arrayBuffer())
        })
      }
      resolveFileUrl={async (url) => resolveAssetUrl(url)}
      createSubPage={async () => {
        await save('auto')
        const node = await api.invoke('page:create', { parentId: doc.id })
        void useApp.getState().setExpanded(doc.id, true)
        return pageLinkHref(node.id)
      }}
      openLink={openHref}
      pageLink={pageLink}
    />
  )
}
```

Replace the whole of `src/renderer/src/components/PageView.tsx` with:

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PageDoc, PageMetaPatch } from '@shared/types'
import { findNode } from '../lib/tree'
import { useApp } from '../store'
import { Banner } from './Banner'
import { PageCover, PageIconAndControls } from './PageHeader'
import { PageEditor, type PageEditorHandle } from './PageEditor'
import { PageTitle } from './PageTitle'
import { TopBar } from './TopBar'

const api = window.api

function applyPatch(doc: PageDoc, patch: PageMetaPatch): PageDoc {
  const meta = { ...doc.meta }
  if (patch.icon !== undefined) meta.icon = patch.icon ?? undefined
  if (patch.cover !== undefined) meta.cover = patch.cover ?? undefined
  if (patch.coverPosition !== undefined) meta.coverPosition = patch.coverPosition ?? undefined
  if (patch.fullWidth !== undefined) meta.fullWidth = patch.fullWidth
  return { ...doc, meta }
}

export function PageView({ theme }: { theme: 'light' | 'dark' }): React.JSX.Element {
  const currentId = useApp((s) => s.currentId)
  const node = useApp((s) => (s.currentId ? findNode(s.tree, s.currentId) : null))
  const [doc, setDoc] = useState<PageDoc | null>(null)
  // Bumped to rebuild the editor from a fresh read of the file.
  const [generation, setGeneration] = useState(0)
  const [conflict, setConflict] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<PageEditorHandle>(null)
  const keepScroll = useRef<number | null>(null)
  const docRef = useRef(doc)
  useLayoutEffect(() => {
    docRef.current = doc
  })
  const onConflict = useCallback(() => setConflict(true), [])

  useEffect(() => {
    if (!currentId) return
    let cancelled = false
    void api.invoke('page:read', { id: currentId }).then((d) => {
      if (cancelled) return
      setDoc(d)
      setConflict(false)
    })
    return () => {
      cancelled = true
    }
  }, [currentId])

  const reload = useCallback(async (): Promise<void> => {
    const id = docRef.current?.id
    if (!id) return
    const fresh = await api.invoke('page:read', { id })
    if (docRef.current?.id !== id) return
    // Typing that started while the page was being read is not thrown away.
    if (editorRef.current?.hasUnsaved()) return setConflict(true)
    keepScroll.current = scrollRef.current?.scrollTop ?? null
    setDoc(fresh)
    setGeneration((g) => g + 1)
    setConflict(false)
  }, [])

  useLayoutEffect(() => {
    if (keepScroll.current !== null && scrollRef.current) {
      scrollRef.current.scrollTop = keepScroll.current
      keepScroll.current = null
    }
  }, [generation])

  useEffect(
    () =>
      window.api.on('page:changed', ({ id, revision }) => {
        const current = docRef.current
        if (!current || current.id !== id) return
        if (revision <= (editorRef.current?.revision() ?? current.revision)) return
        if (editorRef.current?.hasUnsaved()) setConflict(true)
        else void reload()
      }),
    [reload]
  )

  const updateMeta = (patch: PageMetaPatch): void => {
    if (!doc) return
    setDoc(applyPatch(doc, patch))
    void api.invoke('page:meta', { id: doc.id, patch })
  }

  const ready = doc && doc.id === currentId && node

  return (
    <div className="main">
      <TopBar
        doc={ready ? doc : null}
        onToggleFullWidth={() => doc && updateMeta({ fullWidth: !doc.meta.fullWidth })}
      />
      {ready && conflict && (
        <Banner
          tone="warning"
          message="This page was changed outside Nobsidian."
          actions={[
            {
              label: 'Reload',
              onClick: () => void editorRef.current?.discard().then(reload)
            },
            {
              label: 'Keep mine',
              onClick: () =>
                void editorRef.current?.keepMine().then(() => {
                  setConflict(false)
                  bodyRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
                })
            }
          ]}
        />
      )}
      {ready && doc.frontmatterError && (
        <Banner
          tone="info"
          message="This page's frontmatter couldn't be read, so it's shown as text."
        />
      )}
      <div className="page-scroll" data-testid="page-scroll" ref={scrollRef}>
        {ready && (
          <>
            <PageCover meta={doc.meta} onChange={updateMeta} />
            <div className={`page-column ${doc.meta.fullWidth ? 'full-width' : ''}`}>
              <div className={`page-header ${doc.meta.cover ? 'has-cover' : ''}`}>
                <PageIconAndControls meta={doc.meta} onChange={updateMeta} />
                <PageTitle
                  key={doc.id}
                  id={doc.id}
                  title={node.title}
                  onEnter={() =>
                    bodyRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
                  }
                />
              </div>
            </div>
            <div
              className={`page-column page-body ${doc.meta.fullWidth ? 'full-width' : ''}`}
              ref={bodyRef}
            >
              <PageEditor
                key={`${doc.id}:${generation}`}
                ref={editorRef}
                doc={doc}
                theme={theme}
                onConflict={onConflict}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

Apply this change to `src/renderer/src/components/TopBar.tsx`:

```diff
@@ -2,7 +2,7 @@ import { Fragment, useState } from 'react'
 import type { PageDoc } from '@shared/types'
 import { pathTo } from '../lib/tree'
 import { useApp } from '../store'
-import { DotsIcon, SidebarIcon, StarIcon, TrashIcon } from './icons'
+import { ClockIcon, DotsIcon, SidebarIcon, StarIcon, TrashIcon, WidthIcon } from './icons'
 import { Menu } from './Popover'
 import { PageIconView } from './PageIconView'
 
@@ -74,9 +74,16 @@ export function TopBar({
           items={[
             {
               label: doc?.meta.fullWidth ? 'Use default width' : 'Full width',
+              icon: <WidthIcon size={16} />,
               onSelect: onToggleFullWidth
             },
             'separator',
+            {
+              label: 'Page history',
+              icon: <ClockIcon size={16} />,
+              onSelect: () => app().setOverlay({ kind: 'history', pageId: currentId })
+            },
+            'separator',
             {
               label: 'Delete',
               icon: <TrashIcon size={16} />,
```

Apply this change to `src/renderer/src/components/icons.tsx`:

```diff
@@ -174,3 +174,22 @@ export const RestoreIcon = (p: IconProps): React.JSX.Element => (
     <path d="M7.75 5.5 5 8.25 7.75 11" {...stroke} />
   </Svg>
 )
+
+export const ClockIcon = (p: IconProps): React.JSX.Element => (
+  <Svg {...p}>
+    <circle cx="10" cy="10" r="6.75" {...stroke} />
+    <path d="M10 6.25V10l2.5 1.75" {...stroke} />
+  </Svg>
+)
+
+export const CloseIcon = (p: IconProps): React.JSX.Element => (
+  <Svg {...p}>
+    <path d="m5.5 5.5 9 9m0-9-9 9" {...stroke} />
+  </Svg>
+)
+
+export const WidthIcon = (p: IconProps): React.JSX.Element => (
+  <Svg {...p}>
+    <path d="M3 10h14M6 7l-3 3 3 3M14 7l3 3-3 3" {...stroke} />
+  </Svg>
+)
```

Apply this change to `src/renderer/src/styles/app.css`:

```diff
@@ -885,3 +885,82 @@ button {
   color: var(--text-tertiary);
   flex: none;
 }
+
+/* ---------- history ---------- */
+.modal.history {
+  margin-top: 5vh;
+  width: min(1150px, calc(100vw - 48px));
+  height: 90vh;
+  display: flex;
+}
+.history-preview {
+  flex: 1;
+  min-width: 0;
+  overflow-y: auto;
+  background: var(--bg);
+  user-select: text;
+}
+.history-preview .page-header {
+  padding-top: 48px;
+}
+.history-empty {
+  margin: 30vh auto 0;
+  max-width: 340px;
+  text-align: center;
+  color: var(--text-tertiary);
+  line-height: 1.5;
+}
+.history-side {
+  width: 260px;
+  flex: none;
+  display: flex;
+  flex-direction: column;
+  border-left: 1px solid var(--divider);
+  background: var(--bg-sidebar);
+}
+.history-header {
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  height: 48px;
+  padding: 0 10px 0 16px;
+  font-weight: 600;
+  flex: none;
+}
+.history-list {
+  flex: 1;
+  overflow-y: auto;
+  padding: 0 8px;
+}
+.history-item {
+  display: flex;
+  align-items: center;
+  justify-content: space-between;
+  width: 100%;
+  height: 32px;
+  padding: 0 8px;
+  border-radius: 6px;
+  text-align: left;
+  color: var(--sidebar-text);
+}
+.history-item:hover {
+  background: var(--hover);
+}
+.history-item.selected {
+  background: var(--hover-strong);
+  color: var(--text);
+  font-weight: 500;
+}
+.history-current {
+  font-size: 12px;
+  color: var(--text-tertiary);
+  font-weight: 400;
+}
+.history-footer {
+  padding: 12px;
+  border-top: 1px solid var(--divider);
+  flex: none;
+}
+.history-footer .button-primary {
+  width: 100%;
+}
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: 158 unit tests and 23 end-to-end tests pass.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add e2e/external.spec.ts e2e/history.spec.ts src/renderer/src/App.tsx src/renderer/src/components/HistoryModal.tsx src/renderer/src/components/PageEditor.tsx src/renderer/src/components/PageView.tsx src/renderer/src/components/TopBar.tsx src/renderer/src/components/icons.tsx src/renderer/src/styles/app.css
git commit -m "Add page history and the changed-outside banner"
```


---

### Task 9: Table of contents, Duplicate and Cmd+Shift+H

The `/toc` slash item inserts a table of contents that lists the page's headings, indented by level and updated live; clicking one scrolls to it.
"Duplicate" joins the sidebar and top bar page menus.
The formatting toolbar's color button is replaced by one that reports the color picked, so Cmd+Shift+H can toggle the last one (yellow highlight until a color is picked) on the selection.

**Files:**
- Create: `src/renderer/src/editor/ColorButton.tsx`, `src/renderer/src/editor/colors.ts`
- Modify: `src/renderer/src/components/PageEditor.tsx`, `src/renderer/src/components/SidebarRow.tsx`, `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/components/icons.tsx`, `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/editor/editor.css`, `src/renderer/src/editor/schema.tsx`, `src/renderer/src/editor/slashItems.tsx`, `src/renderer/src/store.ts`
- Test: `e2e/pages.spec.ts`

**Interfaces:**
- Consumes: `page:duplicate` (Task 5); `Settings.lastColor`; the `toc` block (Task 1).
- Produces: BlockNote `toc` block spec and "Table of contents" slash item; `AppColorStyleButton`; `ColorPickContext`, `type PickedColor = { kind: 'text' | 'background'; color: string }`; `Editor` props `lastColor?: PickedColor`, `onPickColor?(picked: PickedColor)`; store `duplicatePage(id)`; icons `DuplicateIcon`, `TocIcon`.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `e2e/pages.spec.ts` with:

```ts
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { editor, newPage, rowAction, waitForFile } from './helpers'

test('duplicate copies a page and its sub-pages below the original', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Plan.md'), 'Body\n')
  await mkdir(join(nb.workspace, 'Plan'))
  await writeFile(join(nb.workspace, 'Plan', 'Step.md'), 'Step one\n')
  await writeFile(join(nb.workspace, 'Zebra.md'), 'Last\n')
  const page = await nb.relaunch()
  await rowAction(page, 'Plan', 'Duplicate')
  await expect(page.getByTestId('page-title')).toHaveText('Plan (1)')
  await expect(page.locator('.sidebar-section').last().locator('.sidebar-row-title')).toHaveText([
    'Plan',
    'Plan (1)',
    'Zebra',
    'New page'
  ])
  await expect(page.locator(editor)).toContainText('Body')
  expect(await readdir(join(nb.workspace, 'Plan (1)'))).toEqual(['Step.md'])
})

test('move to picks a new parent from a searchable list', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Inbox.md'), 'Note\n')
  await writeFile(join(nb.workspace, 'Projects.md'), 'All projects\n')
  await writeFile(join(nb.workspace, 'Archive.md'), 'Old\n')
  const page = await nb.relaunch()
  await rowAction(page, 'Inbox', 'Move to')
  const picker = page.getByRole('dialog', { name: 'Move page to' })
  await expect(picker.locator('.search-item-title')).toHaveText([
    'Top level',
    'Archive',
    'Projects'
  ])
  await picker.getByRole('textbox').fill('proj')
  await expect(picker.locator('.search-item-title')).toHaveText(['Projects'])
  await page.keyboard.press('Enter')
  await expect
    .poll(() => readdir(join(nb.workspace, 'Projects')).catch(() => []))
    .toEqual(['Inbox.md'])
})

test('a table of contents lists the headings and jumps to them', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Guide')
  await page.keyboard.type('/toc')
  await page.keyboard.press('Enter')
  await expect(page.locator('.nb-toc-empty')).toHaveText(
    'Add headings to create a table of contents.'
  )
  await page.locator(editor).press('ArrowDown')
  await page.keyboard.type('# Intro')
  await page.keyboard.press('Enter')
  for (let i = 0; i < 40; i++) await page.keyboard.press('Enter')
  await page.keyboard.type('## Details')
  await expect(page.locator('.nb-toc-item')).toHaveText(['Intro', 'Details'])
  await waitForFile(join(workspace, 'Guide.md'), '<nav data-toc></nav>\n\n# Intro')

  const details = page.locator('h2', { hasText: 'Details' })
  await page.getByTestId('page-scroll').evaluate((el) => el.scrollTo(0, 0))
  await expect(details).not.toBeInViewport()
  await page.locator('.nb-toc-item', { hasText: 'Details' }).click()
  await expect(details).toBeInViewport()
})

/** The editor reads the selection asynchronously; its toolbar shows exactly when it has. */
async function selectWordBeforeCursor(page: Page): Promise<void> {
  const toolbar = page.locator('[data-test="colors"]')
  await expect(toolbar).toBeHidden()
  await page.keyboard.press('Shift+Alt+ArrowLeft')
  await expect(toolbar).toBeVisible()
}

test('Cmd+Shift+H applies the last color picked in the toolbar', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Colors')
  await page.keyboard.type('alpha beta')
  // Saved means the editor has applied the typing, so it cannot reset the selection made next.
  await waitForFile(join(workspace, 'Colors.md'), 'alpha beta')
  await selectWordBeforeCursor(page)
  await page.keyboard.press('Meta+Shift+h')
  await waitForFile(join(workspace, 'Colors.md'), 'alpha <span data-bg="yellow">beta</span>')

  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+Alt+ArrowRight')
  // "alpha" has no color yet, unlike the "beta" selected before.
  await expect(
    page.locator('[data-test="colors"] .bn-color-icon[data-background-color="default"]')
  ).toBeVisible()
  await page.locator('[data-test="colors"]').click()
  await page.locator('[data-test="text-color-red"]').click()
  await waitForFile(join(workspace, 'Colors.md'), '<span data-color="red">alpha</span>')

  await page.locator(editor).getByText('beta').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' gamma')
  await waitForFile(join(workspace, 'Colors.md'), 'gamma')
  await selectWordBeforeCursor(page)
  await page.keyboard.press('Meta+Shift+h')
  await waitForFile(join(workspace, 'Colors.md'), '<span data-color="red">gamma</span>')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec electron-vite build && pnpm exec playwright test e2e/pages.spec.ts`
Expected: the duplicate, table of contents and Cmd+Shift+H tests fail; "move to" still passes.

- [ ] **Step 3: Write the implementation**

Apply this change to `src/renderer/src/components/PageEditor.tsx`:

```diff
@@ -46,6 +46,7 @@ export function PageEditor({
   const conflicted = useRef(false)
   const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
   const inFlight = useRef<Promise<void> | null>(null)
+  const lastColor = useApp((s) => s.settings?.lastColor)
   const pageLink = usePageLink()
 
   const keepDraft = useCallback(
@@ -154,6 +155,8 @@ export function PageEditor({
       }}
       openLink={openHref}
       pageLink={pageLink}
+      lastColor={lastColor}
+      onPickColor={(picked) => void useApp.getState().updateSettings({ lastColor: picked })}
     />
   )
 }
```

Apply this change to `src/renderer/src/components/SidebarRow.tsx`:

```diff
@@ -5,6 +5,7 @@ import { useApp } from '../store'
 import {
   ChevronRightIcon,
   DotsIcon,
+  DuplicateIcon,
   MoveIcon,
   PlusIcon,
   RenameIcon,
@@ -137,6 +138,11 @@ export function SidebarRow({
               onSelect: () => void app().toggleFavorite(node.id)
             },
             'separator',
+            {
+              label: 'Duplicate',
+              icon: <DuplicateIcon size={16} />,
+              onSelect: () => void app().duplicatePage(node.id)
+            },
             {
               label: 'Rename',
               icon: <RenameIcon size={16} />,
```

Apply this change to `src/renderer/src/components/TopBar.tsx`:

```diff
@@ -2,7 +2,15 @@ import { Fragment, useState } from 'react'
 import type { PageDoc } from '@shared/types'
 import { pathTo } from '../lib/tree'
 import { useApp } from '../store'
-import { ClockIcon, DotsIcon, SidebarIcon, StarIcon, TrashIcon, WidthIcon } from './icons'
+import {
+  ClockIcon,
+  DotsIcon,
+  DuplicateIcon,
+  SidebarIcon,
+  StarIcon,
+  TrashIcon,
+  WidthIcon
+} from './icons'
 import { Menu } from './Popover'
 import { PageIconView } from './PageIconView'
 
@@ -78,6 +86,11 @@ export function TopBar({
               onSelect: onToggleFullWidth
             },
             'separator',
+            {
+              label: 'Duplicate',
+              icon: <DuplicateIcon size={16} />,
+              onSelect: () => void app().duplicatePage(currentId)
+            },
             {
               label: 'Page history',
               icon: <ClockIcon size={16} />,
```

Apply this change to `src/renderer/src/components/icons.tsx`:

```diff
@@ -193,3 +193,22 @@ export const WidthIcon = (p: IconProps): React.JSX.Element => (
     <path d="M3 10h14M6 7l-3 3 3 3M14 7l3 3-3 3" {...stroke} />
   </Svg>
 )
+
+export const DuplicateIcon = (p: IconProps): React.JSX.Element => (
+  <Svg {...p}>
+    <rect x="7" y="7" width="9.25" height="9.25" rx="2" {...stroke} />
+    <path
+      d="M13 4.75A1.75 1.75 0 0 0 11.25 3h-6.5A1.75 1.75 0 0 0 3 4.75v6.5A1.75 1.75 0 0 0 4.75 13"
+      {...stroke}
+    />
+  </Svg>
+)
+
+export const TocIcon = (p: IconProps): React.JSX.Element => (
+  <Svg {...p}>
+    <path d="M7 5h9.5M9.5 10h7M9.5 15h7" {...stroke} />
+    <circle cx="3.75" cy="5" r="1" />
+    <circle cx="6.25" cy="10" r="1" />
+    <circle cx="6.25" cy="15" r="1" />
+  </Svg>
+)
```

Create `src/renderer/src/editor/ColorButton.tsx`:

```tsx
import {
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorState,
  usePortalElement
} from '@blocknote/react'
import { useContext } from 'react'
import { ColorPickContext, type ColorKind } from './colors'
import type { AppSchema } from './schema'

const COLORS = [
  'default',
  'gray',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink'
] as const

function ColorIcon({
  text,
  background
}: {
  text?: string
  background?: string
}): React.JSX.Element {
  return (
    <div
      className="bn-color-icon"
      data-text-color={text ?? 'default'}
      data-background-color={background ?? 'default'}
      style={{
        pointerEvents: 'none',
        fontSize: 15,
        height: 20,
        lineHeight: '20px',
        width: 20,
        textAlign: 'center'
      }}
    >
      A
    </div>
  )
}

// BlockNote's ColorStyleButton, reporting the picked color.
export function AppColorStyleButton(): React.JSX.Element | null {
  const editor = useBlockNoteEditor<
    AppSchema['blockSchema'],
    AppSchema['inlineContentSchema'],
    AppSchema['styleSchema']
  >()
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const portalElement = usePortalElement()
  const onPick = useContext(ColorPickContext)

  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
      if (!editor.isEditable || !blocks.some((block) => block.content !== undefined))
        return undefined
      const styles = editor.getActiveStyles()
      return {
        text: (styles.textColor as string | undefined) ?? 'default',
        background: (styles.backgroundColor as string | undefined) ?? 'default'
      }
    }
  })

  if (state === undefined) return null

  const apply = (kind: ColorKind, color: string): void => {
    const style = kind === 'text' ? { textColor: color } : { backgroundColor: color }
    if (color === 'default') editor.removeStyles(style)
    else {
      editor.addStyles(style)
      onPick({ kind, color })
    }
    editor.focus()
  }

  const section = (kind: ColorKind): React.JSX.Element[] =>
    COLORS.map((color) => (
      <Components.Generic.Menu.Item
        key={`${kind}-${color}`}
        data-test={`${kind}-color-${color}`}
        icon={<ColorIcon {...(kind === 'text' ? { text: color } : { background: color })} />}
        checked={state[kind] === color}
        onClick={() => apply(kind, color)}
      >
        {dict.color_picker.colors[color]}
      </Components.Generic.Menu.Item>
    ))

  return (
    <Components.Generic.Menu.Root portalElement={portalElement}>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button
          className="bn-button"
          data-test="colors"
          label={dict.formatting_toolbar.colors.tooltip}
          mainTooltip={dict.formatting_toolbar.colors.tooltip}
          icon={<ColorIcon text={state.text} background={state.background} />}
        />
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown bn-color-picker-dropdown">
        <Components.Generic.Menu.Label>
          {dict.color_picker.text_title}
        </Components.Generic.Menu.Label>
        {section('text')}
        <Components.Generic.Menu.Label>
          {dict.color_picker.background_title}
        </Components.Generic.Menu.Label>
        {section('background')}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}
```

Apply this change to `src/renderer/src/editor/Editor.tsx`:

```diff
@@ -14,18 +14,23 @@ import {
   LinkToolbar,
   LinkToolbarController,
   SuggestionMenuController,
+  useBlockNoteEditor,
   useComponentsContext,
   useCreateBlockNote,
   useDictionary,
+  useEditorDOMElement,
   type LinkToolbarProps
 } from '@blocknote/react'
 import { locales as multiColumnLocales, multiColumnDropCursor } from '@blocknote/xl-multi-column'
-import { createContext, useContext } from 'react'
+import { createContext, useContext, useEffect } from 'react'
+import { AppColorStyleButton } from './ColorButton'
+import { ColorPickContext, type PickedColor } from './colors'
 import { AppCreateLinkButton, AppEditLinkButton } from './LinkButtons'
 import { isValidLink, linkHrefFromEvent } from './links'
 import {
   PageLinkContext,
   schema,
+  type AppSchema,
   type AppBlock,
   type AppPartialBlock,
   type PageLinkContextValue
@@ -42,8 +47,13 @@ export type EditorProps = {
   openLink(href: string): void
   pageLink: PageLinkContextValue
   editable?: boolean
+  /** Applied by Cmd+Shift+H. */
+  lastColor?: PickedColor
+  onPickColor?(picked: PickedColor): void
 }
 
+const DEFAULT_COLOR: PickedColor = { kind: 'background', color: 'yellow' }
+
 const OpenLinkContext = createContext<(href: string) => void>(() => {})
 
 // Default items minus text alignment, with link creation that doesn't rewrite hrefs.
@@ -53,7 +63,13 @@ function AppFormattingToolbar(): React.JSX.Element {
       {getFormattingToolbarItems()
         .filter((item) => !String(item.key).startsWith('textAlign'))
         .map((item) =>
-          item.key === 'createLinkButton' ? <AppCreateLinkButton key="createLinkButton" /> : item
+          item.key === 'createLinkButton' ? (
+            <AppCreateLinkButton key="createLinkButton" />
+          ) : item.key === 'colorStyleButton' ? (
+            <AppColorStyleButton key="colorStyleButton" />
+          ) : (
+            item
+          )
         )}
     </FormattingToolbar>
   )
@@ -87,6 +103,32 @@ function AppLinkToolbar(props: LinkToolbarProps): React.JSX.Element {
   )
 }
 
+/** Cmd+Shift+H toggles the last color picked in the toolbar on the selection, like Notion. */
+function HighlightShortcut({ color }: { color: PickedColor }): null {
+  const editor = useBlockNoteEditor<
+    AppSchema['blockSchema'],
+    AppSchema['inlineContentSchema'],
+    AppSchema['styleSchema']
+  >()
+  const dom = useEditorDOMElement()
+  useEffect(() => {
+    const onKeyDown = (event: KeyboardEvent): void => {
+      if (!editor.isEditable || !(event.metaKey || event.ctrlKey) || !event.shiftKey) return
+      if (event.key.toLowerCase() !== 'h') return
+      event.preventDefault()
+      const style =
+        color.kind === 'text' ? { textColor: color.color } : { backgroundColor: color.color }
+      const active = editor.getActiveStyles()
+      const current = color.kind === 'text' ? active.textColor : active.backgroundColor
+      if (current === color.color) editor.removeStyles(style)
+      else editor.addStyles(style)
+    }
+    dom?.addEventListener('keydown', onKeyDown)
+    return () => dom?.removeEventListener('keydown', onKeyDown)
+  }, [editor, dom, color])
+  return null
+}
+
 // Mount with `key={pageId}`: the editor is created once from initialBlocks.
 export function Editor(props: EditorProps): React.JSX.Element {
   const editor = useCreateBlockNote({
@@ -112,24 +154,27 @@ export function Editor(props: EditorProps): React.JSX.Element {
   return (
     <PageLinkContext.Provider value={props.pageLink}>
       <OpenLinkContext.Provider value={props.openLink}>
-        <BlockNoteView
-          editor={editor}
-          theme={props.theme}
-          editable={props.editable !== false}
-          slashMenu={false}
-          formattingToolbar={false}
-          linkToolbar={false}
-          onChange={(ed) => props.onChange(ed.document)}
-        >
-          <SuggestionMenuController
-            triggerCharacter="/"
-            getItems={(query) =>
-              querySlashItems(editor, { createSubPage: props.createSubPage }, query)
-            }
-          />
-          <FormattingToolbarController formattingToolbar={AppFormattingToolbar} />
-          <LinkToolbarController linkToolbar={AppLinkToolbar} />
-        </BlockNoteView>
+        <ColorPickContext.Provider value={props.onPickColor ?? (() => {})}>
+          <BlockNoteView
+            editor={editor}
+            theme={props.theme}
+            editable={props.editable !== false}
+            slashMenu={false}
+            formattingToolbar={false}
+            linkToolbar={false}
+            onChange={(ed) => props.onChange(ed.document)}
+          >
+            <SuggestionMenuController
+              triggerCharacter="/"
+              getItems={(query) =>
+                querySlashItems(editor, { createSubPage: props.createSubPage }, query)
+              }
+            />
+            <FormattingToolbarController formattingToolbar={AppFormattingToolbar} />
+            <LinkToolbarController linkToolbar={AppLinkToolbar} />
+            <HighlightShortcut color={props.lastColor ?? DEFAULT_COLOR} />
+          </BlockNoteView>
+        </ColorPickContext.Provider>
       </OpenLinkContext.Provider>
     </PageLinkContext.Provider>
   )
```

Create `src/renderer/src/editor/colors.ts`:

```ts
import { createContext } from 'react'

export type ColorKind = 'text' | 'background'
export type PickedColor = { kind: ColorKind; color: string }

/** Told about every color picked in the toolbar, so Cmd+Shift+H can reapply it. */
export const ColorPickContext = createContext<(picked: PickedColor) => void>(() => {})
```

Apply this change to `src/renderer/src/editor/editor.css`:

```diff
@@ -237,3 +237,39 @@
 .bn-root .bn-editor [data-content-type='table'] .tableWrapper {
   margin-left: calc(-1 * var(--bn-table-handle-size));
 }
+
+.nb-toc {
+  display: flex;
+  flex-direction: column;
+  width: 100%;
+  padding: 2px 0;
+}
+
+.nb-toc-item {
+  display: block;
+  width: 100%;
+  padding-top: 5px;
+  padding-bottom: 5px;
+  border-radius: 4px;
+  font-size: 14px;
+  line-height: 1.3;
+  text-align: left;
+  color: var(--bn-colors-highlights-gray-text);
+}
+
+.nb-toc-item:hover {
+  background-color: var(--bn-colors-hovered-background);
+}
+
+.nb-toc-text {
+  text-decoration: underline;
+  text-decoration-color: var(--bn-colors-border);
+  text-underline-offset: 3px;
+}
+
+.nb-toc-empty {
+  width: 100%;
+  padding: 5px 2px;
+  font-size: 14px;
+  color: var(--bn-colors-highlights-gray-text);
+}
```

Apply this change to `src/renderer/src/editor/schema.tsx`:

```diff
@@ -7,7 +7,11 @@ import {
   type Block,
   type PartialBlock
 } from '@blocknote/core'
-import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react'
+import {
+  createReactBlockSpec,
+  createReactInlineContentSpec,
+  useEditorChange
+} from '@blocknote/react'
 import { codeBlockOptions } from '@blocknote/code-block'
 import { withMultiColumn } from '@blocknote/xl-multi-column'
 import { createContext, useContext, useState } from 'react'
@@ -104,6 +108,72 @@ export const createPageLink = createReactBlockSpec(
   }
 )
 
+interface TocEntry {
+  id: string
+  level: number
+  text: string
+}
+
+// Structural, so the block spec does not depend on the schema type it is part of.
+interface OutlineBlock {
+  id: string
+  type: string
+  props: { level?: number }
+  content?: unknown
+  children: OutlineBlock[]
+}
+
+type OutlineInline = { type: string; text?: string; content?: { text: string }[] }
+
+function tocEntries(blocks: OutlineBlock[], out: TocEntry[] = []): TocEntry[] {
+  for (const block of blocks) {
+    if (block.type === 'heading' && Array.isArray(block.content)) {
+      const text = (block.content as OutlineInline[])
+        .map((c) => c.text ?? c.content?.map((t) => t.text).join('') ?? '')
+        .join('')
+      out.push({ id: block.id, level: block.props.level ?? 1, text })
+    }
+    tocEntries(block.children, out)
+  }
+  return out
+}
+
+export const createToc = createReactBlockSpec(
+  {
+    type: 'toc',
+    propSchema: {},
+    content: 'none'
+  },
+  {
+    render: function TocBlock({ editor }) {
+      const [entries, setEntries] = useState(() => tocEntries(editor.document as OutlineBlock[]))
+      useEditorChange(() => setEntries(tocEntries(editor.document as OutlineBlock[])), editor)
+      if (entries.length === 0) {
+        return <div className="nb-toc-empty">Add headings to create a table of contents.</div>
+      }
+      const top = Math.min(...entries.map((e) => e.level))
+      return (
+        <nav className="nb-toc">
+          {entries.map((entry) => (
+            <button
+              key={entry.id}
+              className="nb-toc-item"
+              style={{ paddingLeft: 2 + (entry.level - top) * 24 }}
+              onClick={() =>
+                editor.domElement
+                  ?.querySelector(`[data-id="${entry.id}"]`)
+                  ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
+              }
+            >
+              <span className="nb-toc-text">{entry.text || 'Untitled'}</span>
+            </button>
+          ))}
+        </nav>
+      )
+    }
+  }
+)
+
 export const createRaw = createReactBlockSpec(
   {
     type: 'raw',
@@ -138,7 +208,8 @@ export const schema = withMultiColumn(
       callout: createCallout(),
       math: createMath(),
       pageLink: createPageLink(),
-      raw: createRaw()
+      raw: createRaw(),
+      toc: createToc()
     },
     inlineContentSpecs: {
       ...defaultInlineContentSpecs,
```

Apply this change to `src/renderer/src/editor/slashItems.tsx`:

```diff
@@ -5,6 +5,7 @@ import {
 } from '@blocknote/core'
 import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from '@blocknote/react'
 import { getMultiColumnSlashMenuItems } from '@blocknote/xl-multi-column'
+import { TocIcon } from '../components/icons'
 import type { AppEditor, AppPartialBlock } from './schema'
 
 // The React items carry core's `key` at runtime, but their type omits it.
@@ -87,6 +88,16 @@ export function getSlashItems(
         })
       }
     },
+    {
+      title: 'Table of contents',
+      subtext: 'Show an outline of your page',
+      aliases: ['toc', 'outline', 'contents'],
+      group: 'Advanced',
+      icon: <TocIcon size={18} />,
+      onItemClick: () => {
+        insertOrUpdateBlockForSlashMenu(editor, { type: 'toc' })
+      }
+    },
     {
       title: 'Block equation',
       subtext: 'Display a standalone math equation',
```

Apply this change to `src/renderer/src/store.ts`:

```diff
@@ -43,6 +43,7 @@ interface AppState {
   renamePage: (id: string, title: string) => Promise<void>
   movePage: (id: string, parentId: string | null, index: number) => Promise<void>
   trashPage: (id: string) => Promise<void>
+  duplicatePage: (id: string) => Promise<void>
   showTrashEntry: (entry: string | null) => void
   restoreTrash: (entry: string) => Promise<void>
   deleteTrash: (entry: string) => Promise<void>
@@ -166,6 +167,16 @@ export const useApp = create<AppState>((set, get) => ({
     await api.invoke('page:trash', { id }).catch((e) => get().reportError('delete', e))
   },
 
+  duplicatePage: async (id) => {
+    await flushAll()
+    try {
+      const node = await api.invoke('page:duplicate', { id })
+      get().openPage(node.id)
+    } catch (e) {
+      await get().reportError('duplicate', e)
+    }
+  },
+
   showTrashEntry: (entry) => set({ trashEntry: entry }),
 
   restoreTrash: async (entry) => {
```

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: 158 unit tests and 26 end-to-end tests pass.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add e2e/pages.spec.ts src/renderer/src/components/PageEditor.tsx src/renderer/src/components/SidebarRow.tsx src/renderer/src/components/TopBar.tsx src/renderer/src/components/icons.tsx src/renderer/src/editor/ColorButton.tsx src/renderer/src/editor/Editor.tsx src/renderer/src/editor/colors.ts src/renderer/src/editor/editor.css src/renderer/src/editor/schema.tsx src/renderer/src/editor/slashItems.tsx src/renderer/src/store.ts
git commit -m "Add the table of contents block, Duplicate and the Cmd+Shift+H shortcut"
```


---

### Task 10: README, packaged app and flake check

Updates the README's feature list, checks the packaged app (chokidar and MiniSearch must be inside it), and runs the whole end-to-end suite ten times.

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a README that describes search, trash, history and live file changes.

- [ ] **Step 1: Write the implementation**

Apply this change to `README.md`:

```diff
@@ -10,9 +10,12 @@ Your notes are plain Markdown files in a folder you choose, so they stay yours.
 - Notion-style block editor: `/` commands, drag handles, toggles, callouts, columns, tables, code, math.
 - Nested pages in a sidebar, with emoji or image icons and page covers.
 - Notion's look, in light and dark mode.
-- Favorites, and deleted pages go to a trash folder instead of disappearing.
+- Quick search (Cmd+K or Cmd+P) across titles and text, with recent pages.
+- Favorites, duplicate, move to, and a table of contents block.
+- Trash with restore, and page history with restore.
+- Edits made in other apps, Finder or a sync folder show up live, without losing yours.
 
-Search, page history, a trash panel and Notion import are coming next.
+Notion import is coming next.
 
 ## Development
 
@@ -36,7 +39,7 @@ The app is ad-hoc signed rather than signed with an Apple Developer ID, so a dow
 ## How notes are stored
 
 Each page is a `.md` file; a page's child pages live in a folder with the same name.
-Images and files go in `attachments/`, and app data (favorites, page order, trash) lives in `.nobsidian/`.
+Images and files go in `attachments/`, and app data (favorites, page order, trash, page history) lives in `.nobsidian/`.
 Notion-only formatting uses small Markdown extensions, described in `docs/superpowers/specs/2026-10-21-nobsidian-design.md`.
 Opening an existing folder only adds an `id` to each note's frontmatter; a note is rewritten in Nobsidian's Markdown style only when you edit it, and anything the editor can't show (raw HTML, wikilinks, footnotes) is kept exactly as written.
 
```

- [ ] **Step 2: Run the tests and checks**

Run: `pnpm test:packaged`
Expected: the packaged-app test passes (`Nobsidian.app` launches and shows its window).

Run: `pnpm exec electron-vite build && pnpm exec playwright test --repeat-each=10`
Expected: 260 passed.
Any failure must be root-caused and fixed, not retried: the watcher and conflict tests wait on app events and file contents, never on fixed sleeps, and a flake there usually means a real race.

- [ ] **Step 3: Commit (ask Dale first)**

```bash
git add README.md
git commit -m "Describe plan 2's features in the README"
```


---

## Known limitations

- An outside write that lands in the sub-millisecond gap inside a single save (between the app reading the file and renaming its new version over it) is overwritten without a banner.
  Closing that gap needs file locking, which other editors do not use either; every other ordering of an outside write and a save is detected.
- Links in other pages to a page renamed or moved in Finder are not rewritten, so they break as they would in any Markdown editor; renaming or moving in the app rewrites them.
  Rewriting other files on an outside rename would risk sync conflicts between two Macs, so it is left for a later plan.
- Search content is indexed in memory at startup, at about 1 ms per page in the background; searches wait for it to finish.
