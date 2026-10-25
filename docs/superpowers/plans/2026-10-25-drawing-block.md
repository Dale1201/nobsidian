# Drawing Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Dale draw rough doodles in a page with Excalidraw, saved as one `.excalidraw.svg` file per drawing that other Markdown apps show as a picture.

**Architecture:** A `drawing` block holds the internal href of an `.excalidraw.svg` file in `attachments/` and is written to Markdown as an ordinary image link.
On the page it is a plain `<img>`; clicking it opens a full-window Excalidraw editor, loaded with `import()` on first use, which reads the file through IPC and, on Done, saves a new file and points the block at it.
Excalidraw's fonts ship with the app and are served by the main process at `nbfile://excalidraw/fonts/`, and a small `pnpm patch` keeps Excalidraw from reaching for its CDN.

**Tech Stack:** As before (Electron 44, electron-vite 6, Vite 8, React 19, TypeScript 7, BlockNote 0.56, zustand, Vitest 5, Playwright 1.64), plus `@excalidraw/excalidraw` 0.18.1 (MIT).

**Spec:** `docs/superpowers/specs/2026-10-25-drawing-block-design.md`

## How this plan was made

Every task below was built and verified in a scratch prototype first.
That is where three things the spec could not know were found and fixed:

- Excalidraw fetches its fonts with `fetch()` and `FontFace`, which do not work against `file://` from the renderer, so the fonts are served over the app's `nbfile:` scheme with CORS.
- Excalidraw lists `https://esm.sh/...` as a fallback source for every font face, and Chromium requests every listed source, so each font face caused a CSP-blocked request to the CDN.
- Excalidraw's glyph subsetting needs `eval` (Emscripten embind); its worker cannot start from a `file://` page and the page's CSP forbids `eval`, so every save logged two errors.

Writing a test for each Review Focus item below found one real bug: when the page file changed on disk while the editor was open, the page's editor was rebuilt with new block ids and the saved drawing went nowhere; `session.ts` now finds the drawing again in the rebuilt editor by its file.
The prototype also showed the page picture came out at twice the drawn size (Excalidraw's default `exportScale`), that a selected drawing showed a two-tone highlight, and that the editor's bar and canvas differed in dark mode; the code below fixes all three.
In the prototype `pnpm typecheck` and `pnpm lint` are clean, the unit tests grow from 324 to 334, the end-to-end suite grows from 142 to 156 tests and passes in full, the new end-to-end tests pass ten runs in a row, and the packaged app draws with its bundled fonts.

## Global Constraints

- macOS arm64; Node 24 via `.nvmrc` (`source ~/.nvm/nvm.sh && nvm use 24`); pnpm 10.
- `@excalidraw/excalidraw` is pinned to exactly `0.18.1` in `devDependencies` (the renderer bundles it, like BlockNote); the patch in `patches/` is tied to that version.
- Nothing in the app may request a network address while drawing: fonts come from `nbfile://excalidraw/fonts/`, and the CSP stays as strict as it is apart from `nbfile:` in `font-src` and a new `connect-src 'self' nbfile:`.
- No Excalidraw code or CSS loads until a drawing is opened.
- Drawing files are never edited in place: every save writes a new file in `attachments/`.
- Files are always exported light (white background, `exportWithDarkMode: false`, `exportScale: 1`); dark mode is a CSS filter on the page picture.
- Prettier and ESLint clean, explicit return types, `pnpm typecheck` clean.
- End-to-end tests launch the built app through `e2e/fixtures.ts`, wait on app state, never on fixed sleeps.
- Comments are rare and short: only invariants, wire-format constraints, or surprising decisions.
- Never use the em dash character in code, docs or commit messages.
- Never run `git commit` without Dale's explicit permission; never add an agent co-author line.

## Review Focus

Inputs and conditions the spec implies but does not spell out, most likely first, with the test that pins each:

1. **A drawing block copied with Cmd+D, then one copy edited**: both blocks point at the same file; the edited one must get a new file and the other keep the old one.
   Pinned by "a copied drawing is edited on its own" in Task 4.
2. **The page changes on disk while the drawing editor is open** (sync, another editor): the page reloads under the overlay and the block's id changes; the drawing must still land in the page, not be lost.
   Pinned by "a drawing still lands when its page changes on disk while it is open" in Task 4.
3. **A drawing in a read-only page** (Trash, history preview): clicking must not open the editor.
   Pinned by "a drawing in a read-only page does not open" in Task 4.
4. **File names with spaces, parentheses or capitals** (`Drawing (2).excalidraw.svg`, `Cat Sketch.Excalidraw.SVG`): they must parse as drawings and round-trip exactly.
   Pinned by the `drawing` round-trip case and "reads an image of an .excalidraw.svg file as a drawing" in Task 1.
5. **Quitting, or Cmd+Q, with the editor open**: the drawing must be saved and the page must point at it after relaunch.
   Pinned by "quitting with the editor open keeps the drawing" in Task 4.

Two more conditions the prototype turned up are pinned in Task 4 too: a plain SVG that happens to be named `.excalidraw.svg` (it opens as "can't be edited" and is never overwritten), and the theme changing while the editor is open.

---

### Task 1: The drawing block in the Markdown format

**Files:**
- Create: `src/shared/core/drawing.ts`
- Create: `src/shared/core/drawing.test.ts`
- Modify: `src/shared/core/blocks.ts` (block types)
- Modify: `src/shared/core/parse.ts` (`parseParagraph`, `parseMediaHtml`)
- Modify: `src/shared/core/serialize.ts` (`blockToFlow`)
- Modify: `src/shared/core/links.ts` (`mapBlock`)
- Test: `src/shared/core/convert.test.ts`

**Interfaces:**
- Produces: `DRAWING_SUFFIX = '.excalidraw.svg'`, `isDrawingHref(href: string): boolean`, `drawingFileName(href: string): string` in `src/shared/core/drawing.ts`; `DrawingBlock = { type: 'drawing'; props: { url: string }; children: Block[] }` in the `Block` union.

- [ ] **Step 1: Write the failing tests**

Create `src/shared/core/drawing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { drawingFileName, isDrawingHref } from './drawing'
import { mapBlockLinks } from './links'

describe('drawing files', () => {
  it('recognises drawings by their double extension, in any case and encoding', () => {
    expect(isDrawingHref('/attachments/Drawing.excalidraw.svg')).toBe(true)
    expect(isDrawingHref('attachments/My%20Sketch.EXCALIDRAW.svg')).toBe(true)
    expect(isDrawingHref('/attachments/logo.svg')).toBe(false)
    expect(isDrawingHref('/attachments/Drawing.excalidraw')).toBe(false)
  })

  it('names a save after the current file, without its counter', () => {
    expect(drawingFileName('')).toBe('Drawing.excalidraw.svg')
    expect(drawingFileName('/attachments/Drawing%20(3).excalidraw.svg')).toBe(
      'Drawing.excalidraw.svg'
    )
    expect(drawingFileName('/attachments/Cat%20(2023).excalidraw.svg')).toBe(
      'Cat.excalidraw.svg'
    )
    expect(drawingFileName('/attachments/Floor%20plan.excalidraw.svg')).toBe(
      'Floor plan.excalidraw.svg'
    )
    expect(drawingFileName('/attachments/photo.png')).toBe('Drawing.excalidraw.svg')
  })

  it('has its link rewritten like an image', () => {
    const [block] = mapBlockLinks(
      [{ type: 'drawing', props: { url: '/attachments/a.excalidraw.svg' }, children: [] }],
      (href) => `../${href.slice(1)}`
    )
    expect(block.props).toEqual({ url: '../attachments/a.excalidraw.svg' })
  })
})
```

In `src/shared/core/convert.test.ts`, add a round-trip case after `image`:

```ts
    drawing: '![](attachments/Drawing%20\\(2\\).excalidraw.svg)\n',
```

and a new `describe` block before `describe('markdown from other tools', ...)`:

```ts
describe('drawings', () => {
  const drawing = (url: string): Block => ({ type: 'drawing', props: { url }, children: [] })

  it('reads an image of an .excalidraw.svg file as a drawing', () => {
    expect(markdownToBlocks('![](attachments/Cat%20Sketch.Excalidraw.SVG)\n')).toEqual([
      drawing('attachments/Cat%20Sketch.Excalidraw.SVG')
    ])
  })

  it('reads a resized drawing from another tool, dropping its width on save', () => {
    const blocks = markdownToBlocks('<img src="attachments/a.excalidraw.svg" width="300">\n')
    expect(blocks).toEqual([drawing('attachments/a.excalidraw.svg')])
    expect(blocksToMarkdown(blocks)).toBe('![](attachments/a.excalidraw.svg)\n')
  })

  it('keeps other SVG images as images', () => {
    expect(markdownToBlocks('![](attachments/logo.svg)\n')[0].type).toBe('image')
  })

  it('writes nothing for a drawing that was never saved', () => {
    expect(blocksToMarkdown([drawing(''), drawing('attachments/a.excalidraw.svg')])).toBe(
      '![](attachments/a.excalidraw.svg)\n'
    )
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run src/shared/core/drawing.test.ts src/shared/core/convert.test.ts`
Expected: FAIL; `drawing.test.ts` cannot resolve `./drawing`, and the `drawings` cases get `image` blocks instead of `drawing` ones.

- [ ] **Step 3: Add the block type and the file-name helpers**

Create `src/shared/core/drawing.ts`:

```ts
import { decodeHref } from './paths'

export const DRAWING_SUFFIX = '.excalidraw.svg'

export function isDrawingHref(href: string): boolean {
  return decodeHref(href).toLowerCase().endsWith(DRAWING_SUFFIX)
}

/** The file name a drawing is saved under: its current stem without a "(2)" counter, or "Drawing". */
export function drawingFileName(href: string): string {
  const file = decodeHref(href).split('/').pop() ?? ''
  const stem = file.slice(0, -DRAWING_SUFFIX.length).replace(/ \(\d+\)$/, '')
  return (isDrawingHref(href) && stem ? stem : 'Drawing') + DRAWING_SUFFIX
}
```

In `src/shared/core/blocks.ts`, add the type after `FileBlock`:

```ts
export type DrawingBlock = WithoutContent<'drawing', { url: string }>
```

and add `| DrawingBlock` to the `Block` union after `| FileBlock`.

- [ ] **Step 4: Parse and write drawings**

In `src/shared/core/parse.ts`, import the helper next to the other local imports:

```ts
import { isDrawingHref } from './drawing'
```

In `parseParagraph`, at the top of the single-image branch:

```ts
  if (kids.length === 1 && kids[0].type === 'image') {
    if (isDrawingHref(kids[0].url)) {
      return { type: 'drawing', props: { url: kids[0].url }, children: [] }
    }
    return {
```

In `parseMediaHtml`, right after `const a = parseAttrs(html)` in the `<img>` branch:

```ts
    if (a.src && isDrawingHref(a.src)) {
      return { type: 'drawing', props: { url: a.src }, children: [] }
    }
```

In `src/shared/core/serialize.ts`, add a case to `blockToFlow` after `case 'image'`:

```ts
    case 'drawing':
      // A drawing that was never saved has no file to point at.
      if (!block.props.url) return blocksToFlow(block.children)
      return [
        { type: 'paragraph', children: [{ type: 'image', url: block.props.url, alt: null }] },
        ...childrenContainer(block.children)
      ]
```

In `src/shared/core/links.ts`, add `case 'drawing':` to the group with `'image'`, `'video'`, `'audio'` and `'file'` in `mapBlock`, so the main process converts the drawing's href between internal and relative form and rewrites it on moves and renames.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm vitest run src/shared/core`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: clean.
`text.ts` needs no change: a drawing has no `content`, so search sees no text for it.

- [ ] **Step 6: Commit (only with Dale's permission)**

```bash
git add src/shared/core
git commit -m "Read and write drawing blocks as image links to .excalidraw.svg files"
```

### Task 2: Drawing files in the workspace

**Files:**
- Modify: `src/main/workspace/workspace.ts` (`saveAttachment`, new `readDrawing`)
- Modify: `src/shared/ipc.ts` (`IpcContract`)
- Modify: `src/main/handlers.ts` (`registerHandlers`)
- Test: `src/main/workspace/workspace.test.ts`

**Interfaces:**
- Consumes: `DRAWING_SUFFIX`, `isDrawingHref` from Task 1.
- Produces: `Workspace.readDrawing(internalHref: string): Promise<string | null>`; IPC `'drawing:read': [payload: { href: string }, result: string | null]`; `saveAttachment('Drawing.excalidraw.svg', data)` returns `/attachments/Drawing.excalidraw.svg`, then `/attachments/Drawing%20(2).excalidraw.svg`.

- [ ] **Step 1: Write the failing tests**

In `src/main/workspace/workspace.test.ts`, inside `describe('Workspace page operations', ...)`, before `it('refuses asset paths outside the workspace', ...)`:

```ts
  it('numbers drawings before their double extension', async () => {
    const ws = await Workspace.open(root, { settleMs: 0 })
    const svg = new TextEncoder().encode('<svg/>')
    expect(await ws.saveAttachment('Drawing.excalidraw.svg', svg)).toBe(
      '/attachments/Drawing.excalidraw.svg'
    )
    expect(await ws.saveAttachment('Drawing.excalidraw.svg', svg)).toBe(
      '/attachments/Drawing%20(2).excalidraw.svg'
    )
  })

  it('reads drawings, and nothing else, from the workspace', async () => {
    const ws = await Workspace.open(root, { settleMs: 0 })
    const href = await ws.saveAttachment('a.excalidraw.svg', new TextEncoder().encode('<svg/>'))
    await writeFile(join(root, 'secret.svg'), '<svg/>')
    await mkdir(join(root, '.nobsidian'), { recursive: true })
    await writeFile(join(root, '.nobsidian', 'x.excalidraw.svg'), '<svg/>')
    expect(await ws.readDrawing(href)).toBe('<svg/>')
    expect(await ws.readDrawing('/attachments/missing.excalidraw.svg')).toBeNull()
    expect(await ws.readDrawing('/secret.svg')).toBeNull()
    expect(await ws.readDrawing('/.nobsidian/x.excalidraw.svg')).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run src/main/workspace/workspace.test.ts`
Expected: FAIL; the second save returns `/attachments/Drawing.excalidraw%20(2).svg`, and `ws.readDrawing` is not a function.

- [ ] **Step 3: Implement**

In `src/main/workspace/workspace.ts`, import the helpers:

```ts
import { DRAWING_SUFFIX, isDrawingHref } from '../../shared/core/drawing'
```

In `saveAttachment`, replace `const ext = extname(name)` with:

```ts
      const ext = name.toLowerCase().endsWith(DRAWING_SUFFIX)
        ? name.slice(-DRAWING_SUFFIX.length)
        : extname(name)
```

Add this method above `resolveAsset`:

```ts
  /** The text of a drawing file, or null when there is none at that href. */
  async readDrawing(internalHref: string): Promise<string | null> {
    const file = isDrawingHref(internalHref) ? this.resolveAsset(internalHref) : null
    if (!file) return null
    return readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw err
    })
  }
```

In `src/shared/ipc.ts`, add to `IpcContract` after `'attachment:open'`:

```ts
  /** The text of a drawing file, or null when it is missing. */
  'drawing:read': [payload: { href: string }, result: string | null]
```

In `src/main/handlers.ts`, register it after the `'attachment:open'` handler:

```ts
  handle('drawing:read', ({ href }) => ws().readDrawing(href))
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run src/main/workspace/workspace.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit (only with Dale's permission)**

```bash
git add src/main src/shared/ipc.ts
git commit -m "Save drawings with their double extension and read them over IPC"
```

### Task 3: Drawings on the page

The page shows each drawing as a picture of its file.
Opening the editor comes in Task 4; this task makes drawings from other tools, or from Task 4 later, look right.

**Files:**
- Modify: `src/renderer/src/editor/schema.tsx` (new `createDrawing`, added to `schema`)
- Modify: `src/renderer/src/editor/editor.css`
- Create: `e2e/drawing.spec.ts`

**Interfaces:**
- Consumes: the `drawing` block from Task 1; `resolveAssetUrl` from `src/renderer/src/lib/assets.ts`.
- Produces: the BlockNote block spec `drawing` with prop `url` (default `''`); DOM: `.nb-drawing > img` for a drawing, `.nb-drawing-missing` when its file cannot be loaded, `.nb-drawing-new` (empty) while it has no file.

- [ ] **Step 1: Write the failing end-to-end tests**

Create `e2e/drawing.spec.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { expect, test } from './fixtures'
import { openFile } from './helpers'

const SQUARE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#fff"/><rect x="10" y="10" width="100" height="60" fill="none" stroke="#1e1e1e"/></svg>'

async function writeDrawing(workspace: string, name: string): Promise<void> {
  await mkdir(join(workspace, 'attachments'), { recursive: true })
  await writeFile(join(workspace, 'attachments', name), SQUARE)
}

const toggleDarkMode = (app: ElectronApplication): Promise<unknown> =>
  app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Toggle Dark Mode')
      ?.click()
  )

test('a drawing shows as its picture, at the size it was drawn', async ({ nb }) => {
  await writeDrawing(nb.workspace, 'Square.excalidraw.svg')
  const page = await openFile(nb, 'Pictures', 'Above\n\n![](attachments/Square.excalidraw.svg)\n')
  const image = page.locator('.nb-drawing img')
  await expect(image).toHaveJSProperty('naturalWidth', 120)
  expect((await image.boundingBox())!.width).toBe(120)
})

test('the dark theme inverts a drawing so its white background matches the page', async ({
  nb
}) => {
  await writeDrawing(nb.workspace, 'Square.excalidraw.svg')
  const page = await openFile(nb, 'Night', '![](attachments/Square.excalidraw.svg)\n')
  await expect(page.locator('.nb-drawing img')).toHaveCSS('filter', 'none')
  await toggleDarkMode(nb.app)
  await expect(page.locator('.nb-drawing img')).toHaveCSS(
    'filter',
    'invert(0.9) hue-rotate(180deg)'
  )
})

test('a drawing whose file is missing says so', async ({ nb }) => {
  const page = await openFile(nb, 'Lost', '![](attachments/Gone.excalidraw.svg)\n')
  await expect(page.locator('.nb-drawing-missing')).toHaveText(
    'Drawing not found: Gone.excalidraw.svg'
  )
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:e2e e2e/drawing.spec.ts`
Expected: FAIL; the editor's schema has no `drawing` block yet, so `.nb-drawing` and `.nb-drawing-missing` never appear.

- [ ] **Step 3: Add the block spec**

In `src/renderer/src/editor/schema.tsx`, add imports:

```ts
import { decodeHref } from '@shared/core/paths'
import { resolveAssetUrl } from '../lib/assets'
```

Add the spec after `createPageLink`:

```tsx
export const createDrawing = createReactBlockSpec(
  {
    type: 'drawing',
    propSchema: { url: { default: '' } },
    content: 'none'
  },
  {
    render: function DrawingBlock({ block }) {
      const { url } = block.props
      const [missing, setMissing] = useState<string | null>(null)
      // A new drawing has no file until its editor saves one.
      if (!url) return <div className="nb-drawing-new" />
      if (missing === url) {
        return (
          <div className="nb-drawing-missing">
            Drawing not found: {decodeHref(url.split('/').pop() ?? url)}
          </div>
        )
      }
      return (
        <div className="nb-drawing">
          <img
            src={resolveAssetUrl(url)}
            alt=""
            draggable={false}
            onError={() => setMissing(url)}
          />
        </div>
      )
    }
  }
)
```

Register it in `schema`, after `pageLink: createPageLink(),`:

```ts
      drawing: createDrawing(),
```

- [ ] **Step 4: Style it**

Append to `src/renderer/src/editor/editor.css`:

```css
.nb-drawing {
  position: relative;
  width: fit-content;
  max-width: 100%;
  margin: 4px 0;
}

/* The picture is opaque, so the selection tint goes over it to match the rest of the block. */
.bn-block-outer.nb-block-selected .nb-drawing::after {
  content: '';
  position: absolute;
  inset: 0;
  background-color: var(--selected);
}

.nb-drawing img {
  display: block;
  max-width: 100%;
  height: auto;
}

:root[data-theme='dark'] .nb-drawing img {
  filter: invert(90%) hue-rotate(180deg);
}

.nb-drawing-missing {
  padding: 4px 0;
  color: var(--bn-colors-highlights-gray-text);
}
```

`invert(90%)` turns the file's white background into `#1a1a1a`, one step from the dark page's `#191919`, so a drawing has no visible box in either theme.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm test:e2e e2e/drawing.spec.ts && pnpm typecheck && pnpm lint`
Expected: 3 passed; clean.

- [ ] **Step 6: Commit (only with Dale's permission)**

```bash
git add src/renderer/src/editor e2e/drawing.spec.ts
git commit -m "Show drawings on the page as pictures of their files"
```

### Task 4: The drawing editor

Clicking a drawing, pressing Enter on a selected one, or choosing "Drawing" in the slash menu opens Excalidraw over the whole window; Done saves a new file and points the block at it.

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (dependency)
- Create: `pnpm-workspace.yaml`, `patches/@excalidraw__excalidraw@0.18.1.patch` (written by `pnpm patch-commit`)
- Modify: `electron.vite.config.ts` (font copy plugin)
- Modify: `src/shared/ipc.ts` (`EXCALIDRAW_HOST`)
- Modify: `src/main/index.ts` (scheme privilege, font route)
- Modify: `src/renderer/index.html` (CSP)
- Modify: `src/renderer/src/env.d.ts` (`EXCALIDRAW_ASSET_PATH`)
- Create: `src/renderer/src/drawing/session.ts`, `DrawingHost.tsx`, `DrawingEditor.tsx`, `drawing.css`
- Modify: `src/renderer/src/store.ts` (`Overlay`, `registerFlusher`)
- Modify: `src/renderer/src/App.tsx` (render the editor, hold navigation)
- Modify: `src/renderer/src/editor/Editor.tsx` (register the page editor)
- Modify: `src/renderer/src/editor/schema.tsx` (click to open)
- Modify: `src/renderer/src/editor/BlockSelectionKeys.tsx` (Enter to open)
- Modify: `src/renderer/src/editor/slashItems.tsx`, `src/renderer/src/components/icons.tsx` (slash item)
- Modify: `src/renderer/src/editor/editor.css` (pointer cursor)
- Test: `e2e/drawing.spec.ts`

**Interfaces:**
- Consumes: `drawingFileName` (Task 1); IPC `drawing:read` and `attachment:save` (Task 2); the `drawing` block spec (Task 3).
- Produces: `openDrawing(editor: AppEditor, blockId: string): void` and `registerDrawingEditor(editor: AppEditor): () => void` in `src/renderer/src/drawing/session.ts`; `Overlay` kind `{ kind: 'drawing'; session: DrawingSession }`; `registerFlusher(fn, { first: true })`; the editor's DOM is a `role="dialog"` named "Drawing" with a "Done" button.

- [ ] **Step 1: Write the failing end-to-end tests**

Append to `e2e/drawing.spec.ts` (the imports at the top become `mkdir, readFile, readdir, writeFile` from `node:fs/promises`, `ElectronApplication, Locator, Page` from `@playwright/test`, and `newPage, openFile, rowAction, waitForFile` from `./helpers`):

```ts
const overlay = (page: Page): Locator => page.getByRole('dialog', { name: 'Drawing' })

async function insertDrawing(page: Page): Promise<void> {
  await page.keyboard.type('/drawing')
  await page.keyboard.press('Enter')
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
}

async function drawRectangle(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('r')
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 200, y + 120, { steps: 5 })
  await page.mouse.up()
}

async function done(page: Page): Promise<void> {
  await overlay(page).getByRole('button', { name: 'Done' }).click()
  await expect(overlay(page)).toBeHidden()
}

const attachments = (workspace: string): Promise<string[]> =>
  readdir(join(workspace, 'attachments')).catch(() => [])

test('a drawing made from the slash menu is saved as an image link to an editable SVG', async ({
  nb
}) => {
  const { page } = nb
  await newPage(page, 'Sketch')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await done(page)
  const image = page.locator('.nb-drawing img')
  await expect(image).toHaveJSProperty('complete', true)
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(200)
  await waitForFile(join(nb.workspace, 'Sketch.md'), '![](attachments/Drawing.excalidraw.svg)\n')
  const svg = await readFile(join(nb.workspace, 'attachments', 'Drawing.excalidraw.svg'), 'utf8')
  expect(svg).toMatch(/^<svg/)
  expect(svg).toContain('payload-type:application/vnd.excalidraw+json')
})

test('reopening shows the drawing; an edit saves a new file and leaving it unchanged saves none', async ({
  nb
}) => {
  const { page } = nb
  await newPage(page, 'Edits')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await done(page)
  await waitForFile(join(nb.workspace, 'Edits.md'), 'Drawing.excalidraw.svg')

  await page.locator('.nb-drawing').click()
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
  await done(page)
  expect(await attachments(nb.workspace)).toEqual(['Drawing.excalidraw.svg'])

  await page.locator('.nb-drawing').click()
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
  await drawRectangle(page, 300, 600)
  await done(page)
  await waitForFile(
    join(nb.workspace, 'Edits.md'),
    '![](attachments/Drawing%20\\(2\\).excalidraw.svg)'
  )
  expect((await attachments(nb.workspace)).sort()).toEqual([
    'Drawing (2).excalidraw.svg',
    'Drawing.excalidraw.svg'
  ])
})

test('closing a new drawing without drawing removes its block', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Empty')
  await page.keyboard.type('Before')
  await page.keyboard.press('Enter')
  await insertDrawing(page)
  await done(page)
  await expect(page.locator('.bn-block-content[data-content-type="drawing"]')).toHaveCount(0)
  await page.keyboard.type('After')
  await waitForFile(join(nb.workspace, 'Empty.md'), /Before\n\nAfter\n$/)
  expect(await attachments(nb.workspace)).toEqual([])
})

test('Enter opens a selected drawing and Cmd+Enter saves it', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Keys')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await page.keyboard.press('Meta+Enter')
  await expect(overlay(page)).toBeHidden()
  await waitForFile(join(nb.workspace, 'Keys.md'), 'Drawing.excalidraw.svg')
  await expect(page.locator('.nb-block-selected .nb-drawing')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
})

test('quitting with the editor open keeps the drawing', async ({ nb }) => {
  await newPage(nb.page, 'Quit')
  await insertDrawing(nb.page)
  await drawRectangle(nb.page, 500, 400)
  const page = await nb.relaunch()
  await expect(page.locator('.nb-drawing img')).toBeVisible()
  expect(await readFile(join(nb.workspace, 'Quit.md'), 'utf8')).toContain(
    '![](attachments/Drawing.excalidraw.svg)'
  )
})

test('the editor follows the app theme, also when it changes while open', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Themes')
  await insertDrawing(page)
  await expect(overlay(page)).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await toggleDarkMode(nb.app)
  await expect(overlay(page).locator('.excalidraw.theme--dark')).toBeVisible()
  await expect(overlay(page)).toHaveCSS('background-color', 'rgb(18, 18, 18)')
})

test('drawing stays offline and its code loads only when the editor opens', async ({ nb }) => {
  const { page } = nb
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await newPage(page, 'Offline')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await page.keyboard.press('t')
  await page.mouse.click(520, 600)
  await page.keyboard.type('Hi 你好')
  await page.keyboard.press('Escape')
  await done(page)
  const svg = await waitForFile(
    join(nb.workspace, 'attachments', 'Drawing.excalidraw.svg'),
    'font-family: Xiaolai'
  )
  expect(svg).toContain('font-family: Excalifont')
  expect(requests.filter((u) => !/^(file|data|blob|nbfile):/.test(u))).toEqual([])

  requests.length = 0
  const reopened = await nb.relaunch()
  reopened.on('request', (r) => requests.push(r.url()))
  await reopened.getByTestId('sidebar-row-Offline').click()
  await expect(reopened.locator('.nb-drawing img')).toBeVisible()
  expect(requests.filter((u) => /DrawingEditor|excalidraw\//.test(u))).toEqual([])
})

test('a copied drawing is edited on its own', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Copies')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await done(page)
  await page.keyboard.press('Meta+d')
  await expect(page.locator('.nb-drawing')).toHaveCount(2)
  await page.locator('.nb-drawing').nth(1).click()
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
  await drawRectangle(page, 300, 600)
  await done(page)
  await waitForFile(
    join(nb.workspace, 'Copies.md'),
    '![](attachments/Drawing.excalidraw.svg)\n\n![](attachments/Drawing%20\\(2\\).excalidraw.svg)\n'
  )
})

test('a drawing in a read-only page does not open', async ({ nb }) => {
  await writeDrawing(nb.workspace, 'Old.excalidraw.svg')
  const page = await openFile(nb, 'Old', 'Text\n\n![](attachments/Old.excalidraw.svg)\n')
  await expect(page.locator('.nb-drawing')).toHaveCSS('cursor', 'pointer')
  await rowAction(page, 'Old', 'Delete')
  await page.getByRole('button', { name: 'Trash' }).click()
  await page.getByTestId('trash-item-Old').click()
  await expect(page.getByRole('status')).toContainText('This page is in Trash.')
  await expect(page.locator('.nb-drawing')).toHaveCSS('cursor', 'auto')
  await page.locator('.nb-drawing img').click()
  await expect(overlay(page)).toHaveCount(0)
})

test('a plain SVG named like a drawing opens as not editable and is never overwritten', async ({
  nb
}) => {
  await writeDrawing(nb.workspace, 'Logo.excalidraw.svg')
  const page = await openFile(nb, 'Plain', '![](attachments/Logo.excalidraw.svg)\n')
  await page.locator('.nb-drawing').click()
  await expect(overlay(page)).toContainText("This drawing can't be edited")
  await expect(overlay(page).locator('.excalidraw')).toHaveCount(0)
  await done(page)
  expect(await attachments(nb.workspace)).toEqual(['Logo.excalidraw.svg'])
  expect(await readFile(join(nb.workspace, 'attachments', 'Logo.excalidraw.svg'), 'utf8')).toBe(
    SQUARE
  )
})

test('a drawing still lands when its page changes on disk while it is open', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Outside')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await done(page)
  const file = join(nb.workspace, 'Outside.md')
  const text = await waitForFile(file, 'Drawing.excalidraw.svg')
  await page.locator('.nb-drawing').click()
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
  await writeFile(file, `${text}\nTheirs\n`)
  await expect(page.locator('.bn-editor')).toContainText('Theirs')
  await drawRectangle(page, 300, 600)
  await done(page)
  await waitForFile(file, /!\[\]\(attachments\/Drawing%20\\\(2\\\)\.excalidraw\.svg\)\n\nTheirs\n$/)
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:e2e e2e/drawing.spec.ts`
Expected: the three tests from Task 3 pass; the new ones fail because typing `/drawing` finds no slash item and clicking a drawing does nothing, so the "Drawing" dialog never appears.

- [ ] **Step 3: Add Excalidraw and patch it**

Run: `pnpm add -D -E @excalidraw/excalidraw@0.18.1`

Then patch two things in both its builds.
Run `pnpm patch @excalidraw/excalidraw@0.18.1 --edit-dir "$TMPDIR/excalidraw-patch"`, then this script (it fails loudly if 0.18.1's code is not exactly as expected):

```bash
python3 - "$TMPDIR/excalidraw-patch/dist" <<'EOF'
import re, sys
d = sys.argv[1]

def edit(path, fn):
    p = f'{d}/{path}'
    s = open(p).read()
    t = fn(s)
    assert t != s, path
    open(p, 'w').write(t)

def once(old, new):
    def fn(s):
        assert s.count(old) == 1, old[:60]
        return s.replace(old, new)
    return fn

def sub(pattern, new):
    def fn(s):
        t, n = re.subn(pattern, new, s, flags=re.S)
        assert n == 1, pattern[:60]
        return t
    return fn

# 1. No esm.sh fallback source for fonts.
edit('dev/chunk-4FTI6OG3.js',
     once('    urls.push(new URL(assetUrl, _ExcalidrawFontFace.ASSETS_FALLBACK_URL));\n', ''))
edit('prod/chunk-K2UTITRG.js',
     once('return r.push(new URL(n,jn.ASSETS_FALLBACK_URL)),r}', 'return r}'))
# 2. Embed whole font files instead of subsetting them.
edit('dev/chunk-4FTI6OG3.js', sub(
    r'var subsetWoff2GlyphsByCodepoints = async \(arrayBuffer, codePoints\) => \{\n.*?\n\};\n',
    'var subsetWoff2GlyphsByCodepoints = async (arrayBuffer, codePoints) => {\n'
    '  const { toBase64 } = await lazyLoadSharedSubsetChunk();\n'
    '  return toBase64(arrayBuffer);\n};\n'))
edit('prod/chunk-K2UTITRG.js', sub(
    r'qd=async\(e,t\)=>\{let\{Commands:n,subsetToBase64:r,toBase64:o\}=await z6\(\);return Vd\?.*?:r\(e,t\)\},pa=null',
    'qd=async(e,t)=>{let{toBase64:o}=await z6();return o(e)},pa=null'))
EOF
pnpm patch-commit "$TMPDIR/excalidraw-patch"
```

`pnpm patch-commit` writes `patches/@excalidraw__excalidraw@0.18.1.patch` and records it under `patchedDependencies` in `pnpm-workspace.yaml`.
The `dev` hunks are readable and show the intent; the `prod` hunk is one minified line, so the patch file is large.
Why each change is needed is in the spec, section 5: Chromium requests every source of a `FontFace`, so the CDN fallback meant a blocked request per font face, and subsetting needs `eval`.

- [ ] **Step 4: Ship the fonts and serve them**

Replace `electron.vite.config.ts` with:

```ts
import { cpSync } from 'fs'
import { join, resolve } from 'path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const EXCALIDRAW_FONTS = resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')

/** Ships Excalidraw's fonts with the app, so drawings never fetch them from a CDN. */
function excalidrawFonts(): Plugin {
  return {
    name: 'excalidraw-fonts',
    writeBundle(options) {
      cpSync(EXCALIDRAW_FONTS, join(options.dir!, 'excalidraw/fonts'), { recursive: true })
    }
  }
}

export default defineConfig({
  main: {},
  // A sandboxed preload cannot load ES modules.
  preload: { build: { rolldownOptions: { output: { format: 'cjs' } } } },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), excalidrawFonts()]
  }
})
```

In `src/shared/ipc.ts`, after `ASSET_SCHEME`:

```ts
/** The host under ASSET_SCHEME that serves Excalidraw's bundled fonts. */
export const EXCALIDRAW_HOST = 'excalidraw'
```

In `src/main/index.ts`, import `normalize` and `sep` from `node:path` and `EXCALIDRAW_HOST` from `../shared/ipc`; give the scheme `corsEnabled: true` in `registerSchemesAsPrivileged`; add above `let mainWindow`:

```ts
// The build copies Excalidraw's fonts next to the renderer; the dev server has no such folder.
const EXCALIDRAW_FONTS = process.env.ELECTRON_RENDERER_URL
  ? join(__dirname, '../../node_modules/@excalidraw/excalidraw/dist/prod/fonts')
  : join(__dirname, '../renderer/excalidraw/fonts')

function excalidrawFont(pathname: string): string | null {
  const path = normalize(decodeURIComponent(pathname))
  if (!path.startsWith('/fonts/')) return null
  const file = join(EXCALIDRAW_FONTS, path.slice('/fonts/'.length))
  return file.startsWith(EXCALIDRAW_FONTS + sep) ? file : null
}
```

and make the protocol handler serve them:

```ts
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host === EXCALIDRAW_HOST) {
      const file = excalidrawFont(url.pathname)
      if (!file) return new Response('Not found', { status: 404 })
      // Fonts are fetched with CORS from the file:// page.
      const response = await net.fetch(pathToFileURL(file).toString())
      return new Response(response.body, {
        headers: { 'Content-Type': 'font/woff2', 'Access-Control-Allow-Origin': '*' }
      })
    }
    const file = ctx.workspace?.resolveAsset(url.pathname)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
```

`is.dev` cannot pick the folder: it is true for every unpackaged run, end-to-end tests included, which load the built renderer.

In `src/renderer/index.html`, the CSP's `font-src 'self' data:` becomes `font-src 'self' data: nbfile:; connect-src 'self' nbfile:`.

In `src/renderer/src/env.d.ts`, add:

```ts
interface Window {
  /** Where Excalidraw loads its fonts from. */
  EXCALIDRAW_ASSET_PATH?: string | string[]
}
```

- [ ] **Step 5: The session, the host and the editor**

Create `src/renderer/src/drawing/session.ts`:

```ts
import { useApp } from '../store'
import { selectBlocks } from '../editor/blockSelection'
import type { AppBlock, AppEditor } from '../editor/schema'

export interface DrawingSession {
  /** The drawing's file, or '' for one never saved. */
  url: string
  /** Points the block at a newly saved file; false when the block is gone. */
  apply(url: string): boolean
  /** Closes the editor; a drawing that was never saved loses its block. */
  close(): void
}

// The editable page editor; a page changed on disk is rebuilt while a drawing is open.
let pageEditor: AppEditor | null = null

export function registerDrawingEditor(editor: AppEditor): () => void {
  pageEditor = editor
  return () => {
    if (pageEditor === editor) pageEditor = null
  }
}

function drawingsWithUrl(blocks: AppBlock[], url: string, out: AppBlock[] = []): AppBlock[] {
  for (const block of blocks) {
    if (block.type === 'drawing' && block.props.url === url) out.push(block)
    drawingsWithUrl(block.children, url, out)
  }
  return out
}

export function openDrawing(editor: AppEditor, blockId: string): void {
  const block = editor.getBlock(blockId)
  if (block?.type !== 'drawing') return
  let url = block.props.url
  // A rebuilt editor gives every block a new id, so the drawing is found again by its file.
  const nth = drawingsWithUrl(editor.document, url).findIndex((b) => b.id === blockId)
  const locate = (): { editor: AppEditor; id: string } | null => {
    const current = pageEditor
    if (!current) return null
    if (current === editor) {
      return current.getBlock(blockId)?.type === 'drawing' ? { editor, id: blockId } : null
    }
    const same = url ? drawingsWithUrl(current.document, url) : []
    const found = same[nth] ?? same[0]
    return found ? { editor: current, id: found.id } : null
  }
  const session: DrawingSession = {
    url,
    apply: (next) => {
      const target = locate()
      if (!target) return false
      target.editor.updateBlock(target.id, { props: { url: next } })
      url = next
      return true
    },
    close: () => {
      useApp.getState().setOverlay(null)
      const target = locate()
      if (!target) return
      target.editor.focus()
      // Selected, like Notion, so Enter opens it again and arrows move on from it.
      if (url) selectBlocks(target.editor, [target.id])
      else target.editor.removeBlocks([target.id])
    }
  }
  useApp.getState().setOverlay({ kind: 'drawing', session })
}
```

Create `src/renderer/src/drawing/DrawingHost.tsx`:

```tsx
import { ASSET_SCHEME, EXCALIDRAW_HOST } from '@shared/ipc'
import { lazy, Suspense } from 'react'
import type { DrawingSession } from './session'

// Excalidraw reads this when it loads; the main process serves the fonts the build copied.
window.EXCALIDRAW_ASSET_PATH = `${ASSET_SCHEME}://${EXCALIDRAW_HOST}/`

const DrawingEditor = lazy(() => import('./DrawingEditor'))

export function DrawingHost({
  session,
  theme
}: {
  session: DrawingSession
  theme: 'light' | 'dark'
}): React.JSX.Element {
  return (
    <Suspense fallback={<div className="drawing-overlay" />}>
      <DrawingEditor session={session} theme={theme} />
    </Suspense>
  )
}
```

Create `src/renderer/src/drawing/DrawingEditor.tsx`:

```tsx
import '@excalidraw/excalidraw/index.css'
import './drawing.css'

import {
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  exportToSvg,
  getSceneVersion,
  loadFromBlob
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { drawingFileName } from '@shared/core/drawing'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorReason, registerFlusher, useApp } from '../store'
import type { DrawingSession } from './session'

const api = window.api

type Scene = Awaited<ReturnType<typeof loadFromBlob>>
type Loaded = { scene: Scene | null } | { error: string }

async function loadScene(url: string): Promise<Loaded> {
  if (!url) return { scene: null }
  const text = await api.invoke('drawing:read', { href: url })
  if (text === null) return { error: 'Drawing not found' }
  try {
    return { scene: await loadFromBlob(new Blob([text], { type: 'image/svg+xml' }), null, null) }
  } catch {
    return { error: "This drawing can't be edited" }
  }
}

export default function DrawingEditor({
  session,
  theme
}: {
  session: DrawingSession
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const excalidraw = useRef<ExcalidrawImperativeAPI | null>(null)
  const savedVersion = useRef(0)
  const url = useRef(session.url)

  useEffect(() => {
    let live = true
    void loadScene(session.url).then((result) => {
      if (!live) return
      if ('scene' in result) savedVersion.current = getSceneVersion(result.scene?.elements ?? [])
      setLoaded(result)
    })
    return () => {
      live = false
    }
  }, [session.url])

  /** Writes the drawing if it changed; false if that failed. */
  const save = useCallback(async (): Promise<boolean> => {
    const draw = excalidraw.current
    if (!draw) return true
    const elements = draw.getSceneElements()
    const version = getSceneVersion(elements)
    if (version === savedVersion.current) return true
    try {
      const svg = await exportToSvg({
        elements,
        appState: {
          ...draw.getAppState(),
          exportEmbedScene: true,
          exportBackground: true,
          viewBackgroundColor: '#ffffff',
          exportWithDarkMode: false,
          exportScale: 1
        },
        files: draw.getFiles()
      })
      const href = await api.invoke('attachment:save', {
        name: drawingFileName(url.current),
        data: new TextEncoder().encode(svg.outerHTML)
      })
      savedVersion.current = version
      url.current = href
      if (!session.apply(href)) {
        useApp
          .getState()
          .showMessage(`The drawing's block was gone, so it was saved as ${href.slice(1)}.`)
      }
      return true
    } catch (err) {
      useApp.getState().showMessage(`Couldn't save the drawing: ${errorReason(err)}`)
      return false
    }
  }, [session])

  useEffect(() => registerFlusher(save, { first: true }), [save])

  const done = useCallback(async () => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    const saved = await save()
    saving.current = false
    setBusy(false)
    if (saved) session.close()
  }, [save, session])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void done()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [done])

  return (
    <div className="drawing-overlay" role="dialog" aria-modal="true" aria-label="Drawing">
      <div className="drawing-bar drag-region">
        <span className="drawing-title">Drawing</span>
        <button
          className="button-primary drawing-done no-drag"
          disabled={busy || !loaded}
          onClick={() => void (loaded && 'error' in loaded ? session.close() : done())}
        >
          Done
        </button>
      </div>
      <div className="drawing-canvas">
        {loaded && 'error' in loaded && <div className="drawing-error">{loaded.error}</div>}
        {loaded && 'scene' in loaded && (
          <Excalidraw
            excalidrawAPI={(a) => (excalidraw.current = a)}
            initialData={{
              elements: loaded.scene?.elements ?? [],
              files: loaded.scene?.files,
              appState: { viewBackgroundColor: '#ffffff' },
              scrollToContent: true
            }}
            theme={theme}
            autoFocus
            aiEnabled={false}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: false,
                export: false,
                loadScene: false,
                saveAsImage: false,
                saveToActiveFile: false,
                toggleTheme: null
              }
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.DefaultItems.SearchMenu />
              <MainMenu.DefaultItems.Help />
            </MainMenu>
            <WelcomeScreen>
              <WelcomeScreen.Hints.ToolbarHint />
              <WelcomeScreen.Hints.MenuHint />
              <WelcomeScreen.Hints.HelpHint />
            </WelcomeScreen>
          </Excalidraw>
        )}
      </div>
    </div>
  )
}
```

Create `src/renderer/src/drawing/drawing.css`:

```css
.drawing-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

/* Excalidraw's dark canvas colour, so the bar and the canvas are one surface. */
:root[data-theme='dark'] .drawing-overlay {
  background: #121212;
}

.drawing-bar {
  height: var(--topbar-height);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 80px;
  border-bottom: 1px solid var(--divider);
}

.drawing-title {
  font-size: 14px;
  color: var(--text);
}

.drawing-done {
  padding: 4px 12px;
}

.drawing-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
}

.drawing-error {
  margin: 96px auto;
  color: var(--text-secondary);
  text-align: center;
}
```

- [ ] **Step 6: Wire it into the app**

In `src/renderer/src/store.ts`, import the session type (`import type { DrawingSession } from './drawing/session'`), add the overlay kind:

```ts
export type Overlay =
  | { kind: 'search' }
  | { kind: 'move'; pageId: string }
  | { kind: 'history'; pageId: string }
  | { kind: 'drawing'; session: DrawingSession }
```

and let a flusher run before the page editors', so a drawing saved on quit is in the page before the page saves:

```ts
const flushers = new Set<() => Promise<boolean>>()
// Run before the others, for work that ends in an edit the page editors must still save.
const firstFlushers = new Set<() => Promise<boolean>>()
export function registerFlusher(
  fn: () => Promise<boolean>,
  options?: { first?: boolean }
): () => void {
  const set = options?.first ? firstFlushers : flushers
  set.add(fn)
  return () => set.delete(fn)
}
export async function flushAll(): Promise<boolean> {
  const first = await Promise.all([...firstFlushers].map((fn) => fn()))
  return [...first, ...(await Promise.all([...flushers].map((fn) => fn())))].every(Boolean)
}
```

In `src/renderer/src/App.tsx`, import `DrawingHost` from `./drawing/DrawingHost`, render it with the other overlays:

```tsx
          {overlay?.kind === 'drawing' && <DrawingHost session={overlay.session} theme={theme} />}
```

and, first thing in the `menu:command` listener after `const app = useApp.getState()`:

```ts
        // The drawing editor covers the window; only the theme may change under it.
        if (app.overlay?.kind === 'drawing' && cmd !== 'toggle-theme') return
```

Cmd+K search already stays shut while any overlay is open.

In `src/renderer/src/editor/Editor.tsx`, import `registerDrawingEditor` from `../drawing/session` and register editable editors, before the existing attach-files effect:

```ts
  useEffect(
    () => (editable === false ? undefined : registerDrawingEditor(editor)),
    [editor, editable]
  )
```

- [ ] **Step 7: Open drawings from the page, the keyboard and the slash menu**

In `src/renderer/src/editor/schema.tsx`, import `openDrawing` from `../drawing/session`, take `editor` in the drawing's render function (`function DrawingBlock({ block, editor })`), and make the picture's wrapper open it when the page is editable:

```tsx
        <div
          className="nb-drawing"
          data-editable={editor.isEditable ? 'true' : undefined}
          onClick={() => editor.isEditable && openDrawing(editor as unknown as AppEditor, block.id)}
        >
```

In `src/renderer/src/editor/editor.css`, after the `.nb-drawing` rule:

```css
.nb-drawing[data-editable] {
  cursor: pointer;
}
```

In `src/renderer/src/editor/BlockSelectionKeys.tsx`, import `openDrawing` and, at the top of the `Enter` branch in `onSelectionKey`, after `const last = ...`:

```ts
    if (ids.length === 1 && last?.type === 'drawing') {
      openDrawing(editor, last.id)
      return true
    }
```

In `src/renderer/src/components/icons.tsx`, add:

```tsx
export const DrawingIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M14.2 2.9a1.9 1.9 0 0 1 2.7 2.7l-8.6 8.6a2 2 0 0 1-.9.5l-3 .8a.6.6 0 0 1-.7-.7l.8-3a2 2 0 0 1 .5-.9l8.6-8.6Zm1.6 1.1a.4.4 0 0 0-.5 0l-1 1 .5.5 1-1a.4.4 0 0 0 0-.5Zm-2 2.1-.5-.5-6.6 6.6a.5.5 0 0 0-.1.2l-.4 1.4 1.4-.4.2-.1 6.6-6.6-.6-.6ZM3 17.25c0-.4.3-.75.75-.75h12.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75Z" />
  </Svg>
)
```

In `src/renderer/src/editor/slashItems.tsx`, import `DrawingIcon` and `openDrawing`, put `'drawing'` after `'image'` in the Media group of `ORDER`, and add to `customItems` after the callout item:

```tsx
    {
      key: 'drawing',
      title: 'Drawing',
      aliases: ['drawing', 'draw', 'sketch', 'doodle', 'excalidraw', 'whiteboard'],
      icon: <DrawingIcon size={18} />,
      onItemClick: () => {
        const block = insertOrUpdateBlockForSlashMenu(editor, { type: 'drawing' })
        openDrawing(editor, block.id)
      }
    },
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `pnpm typecheck && pnpm lint && pnpm test:e2e e2e/drawing.spec.ts`
Expected: clean; 14 passed.

Check the split: `ls out/renderer/assets | grep DrawingEditor` lists one JS and one CSS chunk, `ls out/renderer/excalidraw/fonts` lists the 9 font folders, and the main `index-*.js` chunk is no more than a few kilobytes larger than before this task.

- [ ] **Step 9: Commit (only with Dale's permission)**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml patches electron.vite.config.ts src e2e/drawing.spec.ts
git commit -m "Draw in a full-window Excalidraw editor, with its fonts served offline"
```

### Task 5: The packaged app, the README, and the final checks

**Files:**
- Modify: `e2e-packaged/packaged.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the packaged-app test**

The packaged app reads the renderer, and so the fonts, from inside `app.asar`; this proves the font route works there.
Append to `e2e-packaged/packaged.spec.ts`:

```ts
test('the packaged app draws with the fonts it ships', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-packaged-'))
  const workspace = await mkdtemp(join(tmpdir(), 'nobsidian-packaged-ws-'))
  await writeFile(join(workspace, 'Sketch.md'), '\n')
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ lastWorkspace: workspace }))
  const app = await launchElectron({ executablePath: APP, env: { NOBSIDIAN_USER_DATA: userData } })
  const page = await app.firstWindow()
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.getByTestId('sidebar-row-Sketch').click()
  await page.locator('.bn-editor').click()
  await page.keyboard.type('/drawing')
  await page.keyboard.press('Enter')
  await expect(page.locator('.excalidraw')).toBeVisible()
  await page.keyboard.press('t')
  await page.mouse.click(500, 400)
  await page.keyboard.type('Hello')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.nb-drawing img')).toBeVisible()
  const svg = await readFile(join(workspace, 'attachments', 'Drawing.excalidraw.svg'), 'utf8')
  expect(svg).toContain('font-family: Excalifont; src: url(data:font/woff2;base64,')
  expect(requests.filter((u) => !/^(file|data|blob|nbfile):/.test(u))).toEqual([])
  await app.close()
})
```

- [ ] **Step 2: Run it**

Run: `pnpm test:packaged`
Expected: 3 passed (the two existing packaged tests and this one).

- [ ] **Step 3: Document drawings in the README**

In `README.md`, add to "Features" after the block editor line:

```markdown
- Drawings: type `/drawing` to sketch with [Excalidraw](https://excalidraw.com) in a full-window editor; the page shows the drawing as a picture.
```

and to "How notes are stored", after the `attachments/` sentence:

```markdown
A drawing is an `.excalidraw.svg` file in `attachments/`, linked from the page like any image, so other Markdown apps show it as a picture; the SVG carries the editable drawing, which excalidraw.com and the Excalidraw VS Code extension can also open.
```

- [ ] **Step 4: Run every check, and the new end-to-end tests ten times over**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: clean; 334 tests pass.

Run: `pnpm test:e2e`
Expected: the whole suite passes.

Run: `pnpm exec playwright test e2e/drawing.spec.ts --repeat-each=10`
Expected: every run passes; a single failure is a flake to fix before calling this done.

- [ ] **Step 5: Look at it**

Run `pnpm dev`, make a drawing with text in it in light and dark mode, and check against the spec: no box around the drawing on the page in either theme, an even tint when it is selected, the editor's bar and canvas one surface, the title clear of the traffic lights.

- [ ] **Step 6: Commit (only with Dale's permission)**

```bash
git add e2e-packaged/packaged.spec.ts README.md
git commit -m "Check drawing in the packaged app, and describe drawings in the README"
```
