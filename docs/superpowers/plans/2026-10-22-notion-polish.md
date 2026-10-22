# Notion Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nobsidian's lists, editor menus, sidebar navigation and typing feel like Notion's Mac app.

**Architecture:** BlockNote stays the editor, but its built-in UI (slash menu, drag handle menu, formatting toolbar) is replaced by our own React components plugged into BlockNote's controllers, all built on one shared menu kit.
List markers and block selection are small ProseMirror plugins wrapped as BlockNote extensions.
Page mentions are a new inline content type that round-trips through Markdown as a link with the title `"mention"`.

**Tech Stack:** Electron 44, React 19, TypeScript 7, BlockNote 0.56 (ProseMirror underneath), zustand, Vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-22-notion-polish-design.md`

## Global Constraints

- Run every Node command after `source ~/.nvm/nvm.sh && nvm use 24`.
- Unit tests: `pnpm vitest run <file>`; all unit tests: `pnpm test`.
- End-to-end tests: `pnpm test:e2e <spec file>` (it builds first and runs hidden; never set `NOBSIDIAN_E2E_SHOW`).
- Before every commit: `pnpm typecheck`, `pnpm lint` and the tests touched by the task pass.
- Never run `git commit` until the user has approved committing for this plan (user CLAUDE.md); commit messages have no co-author line.
- No em dash (U+2014) anywhere: UI copy, comments, docs, commit messages.
- Comments are rare and short: only invariants, wire contracts or surprising decisions.
- Long Markdown: one sentence per line.
- Any bug found along the way starts with an end-to-end reproduction.
- ProseMirror packages are added pinned to the exact versions BlockNote resolves (`prosemirror-state@1.4.4`, `prosemirror-view@1.42.6`, `prosemirror-model@1.25.12`), so plugin keys and decorations share BlockNote's instances.
- Reference values measured from Notion's web app on 2026-10-22:
  - List item: marker column 24px wide, 2px left padding, text starts 6px after the marker, line height 24px.
  - Bullet glyph 1.5em (24px) at depths •, ◦, ▪.
  - Numbered marker centred in the 24px column, depths `1.`, `a.`, `i.`.
  - Checkbox 16px, radius 1.5px; checked fill `rgb(39, 131, 222)` with a white 14px tick; checked text opacity 0.7, line-through at 50% of the text colour.
  - Toggle button 24px, radius 4px, caret 0.8em, rotation 200ms ease-out.
  - Block selection tint `rgba(35, 131, 226, 0.14)` (the existing `--selected` token).

## Review Focus

- A mentioned page that is renamed or moved: the mention shows the new title at once and the file gets the new path and title on its next save (Task 15 and Task 16 tests).
- Files that already contain `> quoted text` still open as quotes after `>` starts typing toggles (Task 12 test).
- Turn into on a block with children and colours keeps both (Task 5 test).
- Menus opened near the bottom or right edge of the window stay fully on screen (Task 2 and Task 4 tests).
- With blocks selected after Esc, typing letters changes nothing and a click returns to normal editing (Task 14 test).

## File Structure

Created:

| File | Responsibility |
|---|---|
| `src/renderer/src/editor/listMarkers.ts` | Pure marker text for bullets and numbers by depth |
| `src/renderer/src/editor/listMarkersPlugin.ts` | ProseMirror plugin that puts `data-marker` on list blocks |
| `src/renderer/src/components/menu/model.ts` | Pure menu entry types, filtering and keyboard index moves |
| `src/renderer/src/components/menu/Menu.tsx` | The shared menu component (keyboard, submenus, search, hints) |
| `src/renderer/src/editor/turnInto.ts` | Pure Turn into options and the block update for each |
| `src/renderer/src/editor/blockActions.ts` | Editor actions: turn into, duplicate, move, delete, colour |
| `src/renderer/src/editor/blockSelection.ts` | Block selection plugin and its API |
| `src/renderer/src/editor/menus/SlashMenu.tsx` | Notion-style slash menu component |
| `src/renderer/src/editor/menus/entries.tsx` | Menu entries for Turn into and Color, shared by block menu and toolbar |
| `src/renderer/src/editor/menus/BlockMenu.tsx` | Block menu host: opens the ⋮⋮ menu and Cmd+/ |
| `src/renderer/src/editor/menus/AppSideMenu.tsx` | The + and ⋮⋮ buttons beside blocks |
| `src/renderer/src/editor/menus/TurnIntoButton.tsx` | "Text ▾" in the selection toolbar |
| `src/renderer/src/editor/markdownShortcuts.ts` | Input rules and Notion keyboard shortcuts as BlockNote extensions |
| `src/renderer/src/editor/BlockSelectionKeys.tsx` | Esc, arrows, Backspace, copy and cut while blocks are selected |
| `src/renderer/src/editor/menus/PagePicker.tsx` | The `@` and `[[` page picker |
| `src/renderer/src/editor/pagePickerItems.ts` | Pure page ranking for the picker |
| `src/renderer/src/editor/useAppEditor.ts` | The editor typed with Nobsidian's schema |
| `src/renderer/src/editor/notionKeys.ts` | Cmd+D, Cmd+Option+number and Cmd+Enter, and `targetBlockIds` |
| `src/renderer/src/editor/blockSelectionModel.ts` | Pure next-selection logic for arrow keys |
| `src/shared/core/mentions.test.ts` | Mention round trip, link rewriting and title refresh |
| `e2e/lists.spec.ts`, `e2e/menus.spec.ts`, `e2e/slash.spec.ts`, `e2e/blockmenu.spec.ts`, `e2e/toolbar.spec.ts`, `e2e/sidebar.spec.ts`, `e2e/shortcuts.spec.ts`, `e2e/mentions.spec.ts` | End-to-end tests per area |

Modified:

| File | Change |
|---|---|
| `src/renderer/src/editor/editor.css` | List, checkbox, toggle, side menu, block selection, toolbar and mention styles |
| `src/renderer/src/editor/Editor.tsx` | Wires the new menus, extensions and the page picker |
| `src/renderer/src/editor/schema.tsx` | Quote and heading spec overrides, `pageMention` inline content |
| `src/renderer/src/editor/slashItems.tsx` | Notion labels, hints, groups and order |
| `src/renderer/src/components/Popover.tsx` | Old `Menu` removed; `Popover` gains `portal` and `closeOnEscape` |
| `src/renderer/src/components/{Sidebar,SidebarRow,TopBar,TrashPopover}.tsx` | Move to the menu kit; sidebar reveal, favorites expansion, drag polish |
| `src/renderer/src/components/icons.tsx` | `DragIcon`, `ChevronDownIcon`, `TurnIntoIcon`, `PaletteIcon` |
| `src/renderer/src/styles/app.css` | Menu kit styles |
| `src/renderer/src/store.ts` | `revealInSidebar`, called by open, back and forward |
| `src/renderer/src/components/PageEditor.tsx` | `createLinkedPage` for the picker |
| `src/shared/core/{blocks,inline,normalize,links,text}.ts` | `pageMention` inline type end to end; `links.ts` also refreshes mention titles |
| `src/main/workspace/{core,workspace,page-history}.ts` | One `toFileBlocks` path that also refreshes mention titles |
| `src/shared/notion/records.ts` | Notion page mentions become mentions |
| `e2e/helpers.ts` | Shared `openFile` helper |

---

# PR 1: Lists, menu kit and editor menus

### Task 1: Notion list markers, checkboxes and toggles

**Files:**
- Create: `src/renderer/src/editor/listMarkers.ts`, `src/renderer/src/editor/listMarkers.test.ts`, `src/renderer/src/editor/listMarkersPlugin.ts`, `e2e/lists.spec.ts`
- Modify: `package.json`, `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/editor/editor.css`, `e2e/helpers.ts`, `e2e/appearance.spec.ts`

**Interfaces:**
- Produces: `bulletMarker(depth: number): string`, `numberMarker(index: number, depth: number): string`, `listMarkers` (BlockNote extension), `openFile(nb, name, body): Promise<Page>` in `e2e/helpers.ts`.

- [ ] **Step 1: Add the ProseMirror packages BlockNote already uses**

```bash
pnpm add -E prosemirror-state@1.4.4 prosemirror-view@1.42.6 prosemirror-model@1.25.12
ls node_modules/.pnpm | grep -E "^prosemirror-(state|view|model)@"
```

Expected: exactly one version of each package is listed.

- [ ] **Step 2: Move the `openFile` helper to `e2e/helpers.ts`**

Cut `openFile` out of `e2e/appearance.spec.ts` and add it to `e2e/helpers.ts` as an export, then import it in `appearance.spec.ts`:

```ts
// e2e/helpers.ts (add imports at the top: writeFile from node:fs/promises, join from node:path)
/** Writes a page file, relaunches so the app reads it, and opens it. */
export async function openFile(
  nb: { workspace: string; relaunch: () => Promise<Page> },
  name: string,
  body: string
): Promise<Page> {
  await writeFile(join(nb.workspace, `${name}.md`), body)
  const page = await nb.relaunch()
  await page.getByTestId(`sidebar-row-${name}`).click()
  await expect(page.locator(editor)).toBeVisible()
  return page
}
```

- [ ] **Step 3: Write the failing unit test for marker text**

```ts
// src/renderer/src/editor/listMarkers.test.ts
import { describe, expect, it } from 'vitest'
import { bulletMarker, numberMarker } from './listMarkers'

describe('list markers', () => {
  it('cycles bullets by depth like Notion', () => {
    expect([0, 1, 2, 3, 4].map(bulletMarker)).toEqual(['•', '◦', '▪', '•', '◦'])
  })

  it('numbers as decimal, then letters, then roman numerals', () => {
    expect(numberMarker(1, 0)).toBe('1.')
    expect(numberMarker(12, 0)).toBe('12.')
    expect(numberMarker(2, 1)).toBe('b.')
    expect(numberMarker(27, 1)).toBe('aa.')
    expect(numberMarker(4, 2)).toBe('iv.')
    expect(numberMarker(1994, 2)).toBe('mcmxciv.')
    expect(numberMarker(3, 3)).toBe('3.')
  })
})
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm vitest run src/renderer/src/editor/listMarkers.test.ts`
Expected: FAIL, cannot resolve `./listMarkers`.

- [ ] **Step 5: Implement the marker text**

```ts
// src/renderer/src/editor/listMarkers.ts
const BULLETS = ['•', '◦', '▪']

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i']
]

export function bulletMarker(depth: number): string {
  return BULLETS[depth % 3]
}

export function numberMarker(index: number, depth: number): string {
  const level = depth % 3
  if (level === 1) return `${letters(index)}.`
  if (level === 2) return `${roman(index)}.`
  return `${index}.`
}

function letters(n: number): string {
  let out = ''
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) {
    out = String.fromCharCode(97 + ((k - 1) % 26)) + out
  }
  return out
}

function roman(n: number): string {
  let out = ''
  let rest = n
  for (const [value, digits] of ROMAN) {
    while (rest >= value) {
      out += digits
      rest -= value
    }
  }
  return out
}
```

- [ ] **Step 6: Run the unit test**

Run: `pnpm vitest run src/renderer/src/editor/listMarkers.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing end-to-end test**

```ts
// e2e/lists.spec.ts
import { expect, test } from './fixtures'
import { editor, openFile } from './helpers'

const markers = (page: import('@playwright/test').Page, type: string): Promise<string[]> =>
  page.evaluate(
    (t) =>
      [...document.querySelectorAll(`.bn-editor .bn-block-content[data-content-type="${t}"]`)].map(
        (el) => getComputedStyle(el, '::before').content
      ),
    type
  )

test('nested blocks have no guide line', async ({ nb }) => {
  const page = await openFile(nb, 'Nested', '- one\n  - two\n    - three\n')
  const borders = await page.evaluate(() =>
    [...document.querySelectorAll('.bn-editor .bn-block-outer')].map(
      (el) => getComputedStyle(el, '::before').borderLeftStyle
    )
  )
  expect(borders.every((b) => b === 'none')).toBe(true)
})

test('bullets change shape with depth and repeat', async ({ nb }) => {
  const page = await openFile(nb, 'Bullets', '- a\n  - b\n    - c\n      - d\n')
  expect(await markers(page, 'bulletListItem')).toEqual(['"•"', '"◦"', '"▪"', '"•"'])
})

test('numbered lists go 1. a. i. by depth and keep their start', async ({ nb }) => {
  const page = await openFile(
    nb,
    'Numbers',
    '1. a\n2. b\n   1. c\n   2. d\n      1. e\n\nbreak\n\n3. x\n4. y\n'
  )
  expect(await markers(page, 'numberedListItem')).toEqual([
    '"1."',
    '"2."',
    '"a."',
    '"b."',
    '"i."',
    '"3."',
    '"4."'
  ])
})

test('list markers sit in a 24px column like Notion', async ({ nb }) => {
  const page = await openFile(nb, 'Column', '- item\n')
  const box = await page.evaluate(() => {
    const el = document.querySelector('.bn-editor [data-content-type="bulletListItem"]')!
    const s = getComputedStyle(el, '::before')
    return { width: s.width, fontSize: s.fontSize, marginLeft: s.marginLeft, marginRight: s.marginRight }
  })
  expect(box).toEqual({ width: '24px', fontSize: '24px', marginLeft: '2px', marginRight: '6px' })
})

test('checkboxes are drawn like Notion', async ({ nb }) => {
  const page = await openFile(nb, 'Todos', '- [ ] open\n- [x] done\n')
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('.bn-editor [data-content-type="checkListItem"] input')].map(
      (el) => {
        const s = getComputedStyle(el)
        return { appearance: s.appearance, width: s.width, height: s.height, bg: s.backgroundColor }
      }
    )
  )
  expect(boxes[0]).toMatchObject({ appearance: 'none', width: '16px', height: '16px' })
  expect(boxes[1].bg).toBe('rgb(39, 131, 222)')
  const done = await page.evaluate(() => {
    const el = document.querySelector(
      '.bn-editor [data-content-type="checkListItem"][data-checked="true"] .bn-inline-content'
    )!
    const s = getComputedStyle(el)
    return { opacity: s.opacity, line: s.textDecorationLine }
  })
  expect(done).toEqual({ opacity: '0.7', line: 'line-through' })
})

test('an empty toggle says how to fill it', async ({ nb }) => {
  const page = await openFile(nb, 'Toggle', '<details>\n<summary>Open me</summary>\n\n</details>\n')
  await page.locator(`${editor} .bn-toggle-button`).click()
  await expect(page.locator(`${editor} .bn-toggle-add-block-button`)).toHaveText(
    'Empty toggle. Click or drop blocks inside.'
  )
})
```

- [ ] **Step 8: Run it to see it fail**

Run: `pnpm test:e2e e2e/lists.spec.ts`
Expected: FAIL on every test (guide line present, BlockNote markers, native checkbox, BlockNote's toggle text).

- [ ] **Step 9: Implement the marker plugin**

```ts
// src/renderer/src/editor/listMarkersPlugin.ts
import { createExtension } from '@blocknote/core'
import type { Node } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { bulletMarker, numberMarker } from './listMarkers'

const key = new PluginKey<DecorationSet>('nbListMarkers')

interface Depths {
  bullet: number
  number: number
}

// Containers can sit in block groups, columns or column lists, so every node is walked.
function markers(doc: Node): DecorationSet {
  const decorations: Decoration[] = []
  const visit = (parent: Node, start: number, depths: Depths): void => {
    let previous: number | null = null
    parent.forEach((child, offset) => {
      const pos = start + offset
      if (child.type.name !== 'blockContainer') {
        previous = null
        visit(child, pos + 1, depths)
        return
      }
      const content = child.firstChild
      if (!content) return
      const contentPos = pos + 1
      const next = { ...depths }
      if (content.type.name === 'bulletListItem') {
        decorations.push(
          Decoration.node(contentPos, contentPos + content.nodeSize, {
            'data-marker': bulletMarker(depths.bullet)
          })
        )
        next.bullet++
        previous = null
      } else if (content.type.name === 'numberedListItem') {
        const index = previous === null ? Number(content.attrs.start) || 1 : previous + 1
        decorations.push(
          Decoration.node(contentPos, contentPos + content.nodeSize, {
            'data-marker': numberMarker(index, depths.number)
          })
        )
        next.number++
        previous = index
      } else {
        previous = null
      }
      const group = child.childCount > 1 ? child.child(1) : null
      if (group) visit(group, contentPos + content.nodeSize + 1, next)
    })
  }
  visit(doc, 0, { bullet: 0, number: 0 })
  return DecorationSet.create(doc, decorations)
}

export const listMarkers = createExtension({
  key: 'nbListMarkers',
  prosemirrorPlugins: [
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, state) => markers(state.doc),
        apply: (tr, set) => (tr.docChanged ? markers(tr.doc) : set)
      },
      props: { decorations: (state) => key.getState(state) }
    })
  ]
})
```

If `createExtension` does not accept a plain object in this BlockNote version, wrap it: `createExtension(() => ({ key: ..., prosemirrorPlugins: [...] }))`, as `NodeSelectionKeyboard.ts` in `@blocknote/core` does.

- [ ] **Step 10: Register the extension and Notion's empty-toggle text**

In `src/renderer/src/editor/Editor.tsx`, import `listMarkers` and change the `useCreateBlockNote` options:

```ts
    dictionary: {
      ...en,
      multi_column: multiColumnLocales.en,
      toggle_blocks: {
        ...en.toggle_blocks,
        add_block_button: 'Empty toggle. Click or drop blocks inside.'
      }
    },
    dropCursor: multiColumnDropCursor,
    extensions: [syntaxHighlighter, listMarkers],
```

- [ ] **Step 11: Add the list, checkbox and toggle styles**

In `src/renderer/src/editor/editor.css`, delete the callout guide-line rule (the block starting `.bn-block:has(> .react-renderer > .bn-block-content[data-content-type='callout']) > .bn-block-group > .bn-block-outer::before`) and the checked to-do rule (`.bn-root [data-content-type='checkListItem'][data-checked='true'] .bn-inline-content`), then append:

```css
/* ---------- Lists like Notion ---------- */
/* Matches BlockNote's indent-line selector with .bn-root in front, so it wins. */
.bn-root
  .bn-block-group
  .bn-block:not(:has(.bn-toggle-wrapper))
  .bn-block-group
  .bn-block-outer:not([data-prev-depth-changed])::before {
  border-left: none;
}

.bn-root .bn-block-outer > .bn-block > .bn-block-content[data-content-type='bulletListItem']::before,
.bn-root .bn-block-outer > .bn-block > .bn-block-content[data-content-type='numberedListItem']::before {
  content: attr(data-marker);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  min-width: 24px;
  height: 24px;
  margin: 0 6px 0 2px;
  padding: 0;
}
.bn-root .bn-block-outer > .bn-block > .bn-block-content[data-content-type='bulletListItem']::before {
  font-size: 1.5em;
  line-height: 1;
}

.bn-root .bn-block-content[data-content-type='checkListItem'] > div:has(> input) {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0 6px 0 2px;
}
.bn-root .bn-block-content[data-content-type='checkListItem'] > div > input {
  appearance: none;
  width: 16px;
  height: 16px;
  margin: 0;
  border-radius: 1.5px;
  box-shadow: inset 0 0 0 1.5px currentColor;
  cursor: pointer;
}
.bn-root .bn-block-content[data-content-type='checkListItem'] > div > input:hover {
  background-color: var(--bn-colors-hovered-background);
}
.bn-root .bn-block-content[data-content-type='checkListItem'] > div > input:checked {
  box-shadow: none;
  background: rgb(39, 131, 222)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='white'%3E%3Cpath d='M11.62 3.18a.876.876 0 0 1 1.5.9l-5.244 8.74a.876.876 0 0 1-1.414.12L2.966 8.86a.875.875 0 1 1 1.328-1.138L7 10.879z'/%3E%3C/svg%3E")
    center / 14px no-repeat;
}
.bn-root [data-content-type='checkListItem'][data-checked='true'] .bn-inline-content {
  opacity: 0.7;
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, currentColor 50%, transparent);
}

.bn-root .bn-toggle-button {
  width: 24px;
  height: 24px;
  margin: 0 6px 0 2px;
  padding: 0;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: transform 200ms ease-out;
}
.bn-root .bn-toggle-button > svg {
  display: none;
}
/* Notion's filled caret, pointing right while closed; BlockNote rotates the button when open. */
.bn-root .bn-toggle-button::before {
  content: '';
  width: 0.8em;
  height: 0.8em;
  background-color: currentColor;
  transform: rotate(-90deg);
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M2.835 3.25a.8.8 0 0 0-.69 1.203l5.164 8.854a.8.8 0 0 0 1.382 0l5.165-8.854a.8.8 0 0 0-.691-1.203z'/%3E%3C/svg%3E")
    center / contain no-repeat;
}
.bn-root .bn-toggle-add-block-button {
  padding: 3px 2px 3px 32px;
  color: var(--nb-muted);
  text-align: left;
}
```

- [ ] **Step 12: Run the end-to-end test**

Run: `pnpm test:e2e e2e/lists.spec.ts`
Expected: PASS.
If the guide line test still fails, read the computed `::before` rule in the failing outer with `getComputedStyle` and match the selector BlockNote ships in `node_modules/@blocknote/react/src/editor/styles.css` (search `Indent line styling`).
If markers inside columns are missing, check the column structure with `editor.prosemirrorState.doc.toJSON()` and adjust `visit`.

- [ ] **Step 13: Check the look in both themes**

Run: `pnpm test:e2e e2e/screenshots.spec.ts` and open `test-results/reference-light.png` and `test-results/reference-dark.png`.
Expected: bullets, numbers, checkboxes and the toggle line up with the text the way they do in Notion; nothing overlaps.

- [ ] **Step 14: Run everything and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e e2e/lists.spec.ts e2e/appearance.spec.ts`
Expected: all pass.

```bash
git add package.json pnpm-lock.yaml src/renderer/src/editor e2e/helpers.ts e2e/appearance.spec.ts e2e/lists.spec.ts
git commit -m "Draw lists, checkboxes and toggles like Notion"
```

### Task 2: Shared menu kit

**Files:**
- Create: `src/renderer/src/components/menu/model.ts`, `src/renderer/src/components/menu/model.test.ts`, `src/renderer/src/components/menu/Menu.tsx`, `e2e/menus.spec.ts`
- Modify: `src/renderer/src/components/Popover.tsx`, `src/renderer/src/components/SidebarRow.tsx`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/TopBar.tsx`, `src/renderer/src/components/TrashPopover.tsx`, `src/renderer/src/components/icons.tsx`, `src/renderer/src/styles/app.css`

**Interfaces:**
- Produces:
  - `type MenuEntry = MenuItemEntry | { kind: 'section'; label: string } | { kind: 'separator' }`
  - `interface MenuItemEntry { kind: 'item'; id: string; label: string; icon?: ReactNode; hint?: string; danger?: boolean; checked?: boolean; keywords?: string[]; submenu?: MenuEntry[]; onSelect?: () => void }`
  - `filterEntries(entries: MenuEntry[], query: string): MenuEntry[]`
  - `moveIndex(entries: MenuEntry[], from: number, delta: 1 | -1): number`
  - `<Menu anchor align? side? entries onClose search? header? className? />`
  - `Popover` props gain `portal?: boolean` (default true) and `closeOnEscape?: boolean` (default true).
  - Icons: `ChevronDownIcon`, `DragIcon`, `TurnIntoIcon`, `PaletteIcon`.

- [ ] **Step 1: Write the failing model test**

```ts
// src/renderer/src/components/menu/model.test.ts
import { describe, expect, it } from 'vitest'
import { filterEntries, moveIndex, type MenuEntry } from './model'

const entries: MenuEntry[] = [
  { kind: 'section', label: 'Actions' },
  {
    kind: 'item',
    id: 'turn',
    label: 'Turn into',
    submenu: [
      { kind: 'item', id: 'h1', label: 'Heading 1' },
      { kind: 'item', id: 'quote', label: 'Quote', keywords: ['blockquote'] }
    ]
  },
  { kind: 'separator' },
  { kind: 'item', id: 'dup', label: 'Duplicate' },
  { kind: 'item', id: 'del', label: 'Delete', danger: true }
]

const ids = (list: MenuEntry[]): string[] =>
  list.map((e) => (e.kind === 'item' ? e.id : e.kind))

describe('filterEntries', () => {
  it('returns everything for an empty query', () => {
    expect(filterEntries(entries, '  ')).toBe(entries)
  })

  it('matches labels and keywords, every word, ignoring case', () => {
    expect(ids(filterEntries(entries, 'DUP'))).toEqual(['dup'])
    expect(ids(filterEntries(entries, 'block'))).toEqual(['quote'])
    expect(ids(filterEntries(entries, 'heading 1'))).toEqual(['h1'])
  })

  it('finds submenu items and drops sections and separators left empty', () => {
    expect(ids(filterEntries(entries, 'turn'))).toEqual(['section', 'turn'])
    expect(ids(filterEntries(entries, 'zzz'))).toEqual([])
  })
})

describe('moveIndex', () => {
  it('skips sections and separators and wraps around', () => {
    expect(moveIndex(entries, -1, 1)).toBe(1)
    expect(moveIndex(entries, 1, 1)).toBe(3)
    expect(moveIndex(entries, 4, 1)).toBe(1)
    expect(moveIndex(entries, 1, -1)).toBe(4)
  })

  it('returns -1 when there is nothing to select', () => {
    expect(moveIndex([{ kind: 'separator' }], -1, 1)).toBe(-1)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/renderer/src/components/menu/model.test.ts`
Expected: FAIL, cannot resolve `./model`.

- [ ] **Step 3: Implement the model**

```ts
// src/renderer/src/components/menu/model.ts
import type { ReactNode } from 'react'

export interface MenuItemEntry {
  kind: 'item'
  id: string
  label: string
  icon?: ReactNode
  /** Muted text on the right, such as a shortcut. */
  hint?: string
  danger?: boolean
  checked?: boolean
  /** Extra words the search box matches. */
  keywords?: string[]
  submenu?: MenuEntry[]
  onSelect?: () => void
}

export type MenuEntry = MenuItemEntry | { kind: 'section'; label: string } | { kind: 'separator' }

/** Matching items, with submenu items brought up to the top level, as Notion's search does. */
export function filterEntries(entries: MenuEntry[], query: string): MenuEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return entries
  const matches = (e: MenuItemEntry): boolean => {
    const text = [e.label, ...(e.keywords ?? [])].join(' ').toLowerCase()
    return words.every((w) => text.includes(w))
  }
  const out: MenuEntry[] = []
  for (const entry of entries) {
    if (entry.kind === 'section') out.push(entry)
    if (entry.kind !== 'item') continue
    if (matches(entry)) out.push(entry)
    if (entry.submenu) {
      out.push(...filterEntries(entry.submenu, query).filter((e) => e.kind === 'item'))
    }
  }
  return out.filter((e, i) => e.kind !== 'section' || out[i + 1]?.kind === 'item')
}

export function moveIndex(entries: MenuEntry[], from: number, delta: 1 | -1): number {
  const items = entries.flatMap((e, i) => (e.kind === 'item' ? [i] : []))
  if (items.length === 0) return -1
  const at = items.indexOf(from)
  if (at === -1) return delta === 1 ? items[0] : items[items.length - 1]
  return items[(at + delta + items.length) % items.length]
}
```

- [ ] **Step 4: Run the model test**

Run: `pnpm vitest run src/renderer/src/components/menu/model.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing end-to-end test**

```ts
// e2e/menus.spec.ts
import { expect, test } from './fixtures'
import { newPage } from './helpers'

test('page actions menu works from the keyboard', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Alpha')
  const row = page.getByTestId('sidebar-row-Alpha')
  await row.hover()
  await row.getByRole('button', { name: 'Page actions' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.locator('.menu-item.active')).toHaveText('Add to Favorites')
  await page.keyboard.press('ArrowDown')
  await expect(menu.locator('.menu-item.active')).toHaveText('Duplicate')
  const rows = page.locator('[data-testid^="sidebar-row-"]')
  const before = await rows.count()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(rows).toHaveCount(before + 1)
})

test('hovering an item highlights it, and Escape closes the menu', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Beta')
  const row = page.getByTestId('sidebar-row-Beta')
  await row.hover()
  await row.getByRole('button', { name: 'Page actions' }).click()
  const menu = page.getByRole('menu')
  await menu.getByRole('menuitem', { name: 'Rename' }).hover()
  await expect(menu.locator('.menu-item.active')).toHaveText('Rename')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('a menu opened near the window edge stays on screen', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Gamma')
  await page.getByRole('button', { name: 'Page menu' }).click()
  const box = await page.getByRole('menu').boundingBox()
  const size = page.viewportSize()!
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height)
})
```

- [ ] **Step 6: Run it to see it fail**

Run: `pnpm test:e2e e2e/menus.spec.ts`
Expected: FAIL, there is no `role="menu"` or `.menu-item.active`.

- [ ] **Step 7: Give `Popover` the options submenus need**

In `src/renderer/src/components/Popover.tsx`, delete the old `MenuItem` interface and `Menu` function, add the two props, and use them:

```tsx
export interface PopoverProps {
  anchor: DOMRect
  align?: 'start' | 'end'
  /** Below the anchor (default), or beside it to the right, bottom-aligned. */
  side?: 'below' | 'right'
  /** Clicks inside this element do not count as outside clicks. */
  ignore?: Element | null
  /** Rendered in place instead of in document.body, so a parent menu counts its clicks as inside. */
  portal?: boolean
  closeOnEscape?: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  role?: string
}
```

Inside `Popover`, destructure `portal = true`, `closeOnEscape = true` and `role`, return early from `onKey` when `!closeOnEscape`, add `role={role}` to the div, and end with:

```tsx
  const panel = (
    <div ref={ref} role={role} className={`menu ${className ?? ''}`} style={{ top: pos.top, left: pos.left }}>
      {children}
    </div>
  )
  return portal ? createPortal(panel, document.body) : panel
```

For `side === 'right'`, keep the top aligned with the anchor instead of its bottom, as a submenu needs: replace the `side === 'right'` branch with:

```tsx
    if (side === 'right') {
      const fitsRight = anchor.right + 4 + width <= window.innerWidth - 8
      const left = fitsRight ? anchor.right + 4 : Math.max(8, anchor.left - width - 4)
      setPos({ top: Math.max(8, Math.min(anchor.top - 4, window.innerHeight - height - 8)), left })
      return
    }
```

Check `TrashPopover` still opens beside the Trash button as before (it uses `side="right"`); if its bottom alignment matters, pass `side="right"` through a new value `'right-bottom'` that keeps the old branch.

- [ ] **Step 8: Add the icons**

```tsx
// src/renderer/src/components/icons.tsx
export const ChevronDownIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4.6 7.4a.75.75 0 0 1 1.06 0L10 11.74l4.34-4.34a.75.75 0 1 1 1.06 1.06l-4.87 4.87a.75.75 0 0 1-1.06 0L4.6 8.46a.75.75 0 0 1 0-1.06Z" />
  </Svg>
)

export const DragIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="7.5" cy="5" r="1.3" />
    <circle cx="12.5" cy="5" r="1.3" />
    <circle cx="7.5" cy="10" r="1.3" />
    <circle cx="12.5" cy="10" r="1.3" />
    <circle cx="7.5" cy="15" r="1.3" />
    <circle cx="12.5" cy="15" r="1.3" />
  </Svg>
)

export const TurnIntoIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 7.25A3.25 3.25 0 0 1 7.25 4h6.69l-1.47-1.47a.75.75 0 1 1 1.06-1.06l2.75 2.75a.75.75 0 0 1 0 1.06l-2.75 2.75a.75.75 0 1 1-1.06-1.06l1.47-1.47H7.25A1.75 1.75 0 0 0 5.5 7.25v1a.75.75 0 0 1-1.5 0v-1Zm12 5.5A3.25 3.25 0 0 1 12.75 16H6.06l1.47 1.47a.75.75 0 1 1-1.06 1.06l-2.75-2.75a.75.75 0 0 1 0-1.06l2.75-2.75a.75.75 0 1 1 1.06 1.06L6.06 14.5h6.69a1.75 1.75 0 0 0 1.75-1.75v-1a.75.75 0 0 1 1.5 0v1Z" />
  </Svg>
)

export const PaletteIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M10 3a7 7 0 0 0 0 14c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01a1.5 1.5 0 0 1 1.12-2.49H14a3 3 0 0 0 3-3C17 5.69 13.87 3 10 3Zm-4 7.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm2-3a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm4 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
  </Svg>
)
```

- [ ] **Step 9: Implement the menu component**

```tsx
// src/renderer/src/components/menu/Menu.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Popover } from '../Popover'
import { ChevronRightIcon } from '../icons'
import { filterEntries, moveIndex, type MenuEntry, type MenuItemEntry } from './model'

export interface MenuProps {
  anchor: DOMRect
  align?: 'start' | 'end'
  side?: 'below' | 'right'
  entries: MenuEntry[]
  onClose: () => void
  /** Placeholder of a search box that filters the entries. */
  search?: string
  header?: string
  className?: string
  /** Set on submenus, which render inside their parent. */
  nested?: boolean
}

export function Menu(props: MenuProps): React.JSX.Element {
  const { entries, onClose, nested } = props
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterEntries(entries, query), [entries, query])
  const [active, setActive] = useState(() => moveIndex(shown, -1, 1))
  const [sub, setSub] = useState<{ index: number; rect: DOMRect } | null>(null)
  const rows = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    setActive(moveIndex(shown, -1, 1))
    setSub(null)
  }, [shown])

  const select = (index: number): void => {
    const entry = shown[index]
    if (entry?.kind !== 'item') return
    if (entry.submenu) {
      const rect = rows.current[index]?.getBoundingClientRect()
      if (rect) setSub({ index, rect })
      return
    }
    onClose()
    entry.onSelect?.()
  }

  // Capture phase, so keys reach the menu before the editor, which may still have focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (sub) return
      const handled = ((): boolean => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          setActive((i) => moveIndex(shown, i, e.key === 'ArrowDown' ? 1 : -1))
          return true
        }
        if (e.key === 'Enter') {
          select(active)
          return true
        }
        if (e.key === 'ArrowRight' && (shown[active] as MenuItemEntry | undefined)?.submenu) {
          select(active)
          return true
        }
        if (e.key === 'Escape' || (e.key === 'ArrowLeft' && nested)) {
          onClose()
          return true
        }
        return false
      })()
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })

  useEffect(() => {
    rows.current[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const subEntry = sub ? (shown[sub.index] as MenuItemEntry) : null

  return (
    <Popover
      anchor={props.anchor}
      align={props.align}
      side={props.side}
      portal={!nested}
      closeOnEscape={false}
      onClose={onClose}
      role="menu"
      className={props.className}
    >
      {props.search !== undefined && (
        <input
          className="menu-search"
          autoFocus
          placeholder={props.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {props.header && !query && <div className="menu-section">{props.header}</div>}
      <div className="menu-list">
        {shown.length === 0 && <div className="menu-empty">No results</div>}
        {shown.map((entry, i) => {
          if (entry.kind === 'separator') return <div key={i} className="menu-separator" />
          if (entry.kind === 'section') {
            return (
              <div key={i} className="menu-section">
                {entry.label}
              </div>
            )
          }
          return (
            <button
              key={entry.id}
              ref={(el) => {
                rows.current[i] = el
              }}
              type="button"
              role="menuitem"
              className={`menu-item ${i === active ? 'active' : ''} ${entry.danger ? 'danger' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={(e) => {
                setActive(i)
                setSub(entry.submenu ? { index: i, rect: e.currentTarget.getBoundingClientRect() } : null)
              }}
              onClick={() => select(i)}
            >
              {entry.icon && <span className="menu-item-icon">{entry.icon}</span>}
              <span className="menu-item-label">{entry.label}</span>
              {entry.hint && <span className="menu-item-hint">{entry.hint}</span>}
              {entry.checked && <span className="menu-item-check">✓</span>}
              {entry.submenu && <ChevronRightIcon size={12} className="menu-item-chevron" />}
            </button>
          )
        })}
      </div>
      {sub && subEntry?.submenu && (
        <Menu
          nested
          anchor={sub.rect}
          side="right"
          entries={subEntry.submenu}
          onClose={() => setSub(null)}
        />
      )}
    </Popover>
  )
}
```

When a submenu item is chosen, the submenu's `onClose` only closes the submenu; wrap each submenu item's `onSelect` so the root closes too. Do it where submenus are passed down: replace `entries={subEntry.submenu}` with `entries={closeAfter(subEntry.submenu, onClose)}` and add:

```tsx
function closeAfter(entries: MenuEntry[], close: () => void): MenuEntry[] {
  return entries.map((e) =>
    e.kind === 'item' && !e.submenu
      ? { ...e, onSelect: () => (close(), e.onSelect?.()) }
      : e.kind === 'item' && e.submenu
        ? { ...e, submenu: closeAfter(e.submenu, close) }
        : e
  )
}
```

If lint rejects the comma expression, write the arrow body as a block with two statements.

- [ ] **Step 10: Style the kit**

In `src/renderer/src/styles/app.css`, replace the `/* ---------- menus ---------- */` section with:

```css
/* ---------- menus ---------- */
.menu {
  position: fixed;
  z-index: 100;
  min-width: 220px;
  max-width: 320px;
  background: var(--menu-bg);
  box-shadow: var(--menu-shadow);
  border-radius: 10px;
  padding: 4px;
  color: var(--text);
  font-size: 14px;
}
.menu-list {
  max-height: min(60vh, 480px);
  overflow-y: auto;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  text-align: left;
}
.menu-item.active {
  background: var(--hover);
}
.menu-item.danger.active {
  color: var(--color-red);
}
.menu-item-icon {
  width: 20px;
  height: 20px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}
.menu-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-item-hint,
.menu-item-check,
.menu-item-chevron {
  flex: none;
  font-size: 12px;
  color: var(--text-tertiary);
}
.menu-section {
  padding: 6px 8px 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.menu-separator {
  height: 1px;
  background: var(--divider);
  margin: 4px 0;
}
.menu-search {
  width: 100%;
  height: 28px;
  margin-bottom: 4px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: var(--input-bg);
  box-shadow: inset 0 0 0 1px var(--divider);
  color: var(--text);
  font: inherit;
  outline: none;
}
.menu-search:focus {
  box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 2px var(--selected);
}
.menu-empty {
  padding: 4px 8px;
  color: var(--text-tertiary);
}
```

Delete the now-unused `.menu-item:hover` and `.menu-item.danger:hover` rules if any copy of them remains.

- [ ] **Step 11: Move the sidebar row, workspace and page menus onto the kit**

In `SidebarRow.tsx`, `Sidebar.tsx` and `TopBar.tsx`, import `{ Menu }` from `./menu/Menu` instead of `./Popover`, rename the `items` prop to `entries`, and convert each entry: `{ label, icon, onSelect }` gains `kind: 'item'` and an `id`, `danger` stays, and `'separator'` becomes `{ kind: 'separator' }`.
The sidebar row menu becomes:

```tsx
        <Menu
          anchor={menu}
          onClose={() => setMenu(null)}
          entries={[
            {
              kind: 'item',
              id: 'favorite',
              label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
              icon: <StarIcon size={16} filled={isFavorite} />,
              onSelect: () => void app().toggleFavorite(node.id)
            },
            { kind: 'separator' },
            {
              kind: 'item',
              id: 'duplicate',
              label: 'Duplicate',
              icon: <DuplicateIcon size={16} />,
              onSelect: () => void app().duplicatePage(node.id)
            },
            {
              kind: 'item',
              id: 'rename',
              label: 'Rename',
              icon: <RenameIcon size={16} />,
              onSelect: () => app().setRenaming(node.id)
            },
            {
              kind: 'item',
              id: 'move',
              label: 'Move to',
              icon: <MoveIcon size={16} />,
              onSelect: () => app().setOverlay({ kind: 'move', pageId: node.id })
            },
            { kind: 'separator' },
            {
              kind: 'item',
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon size={16} />,
              danger: true,
              onSelect: () => void app().trashPage(node.id)
            }
          ]}
        />
```

Give the workspace menu and page menu entries ids from their labels in kebab case (`full-width`, `duplicate`, `page-history`, and so on).
In `TrashPopover.tsx`, change its search input's class to `menu-search` so it matches the kit.

- [ ] **Step 12: Run the tests**

Run: `pnpm test:e2e e2e/menus.spec.ts e2e/pages.spec.ts e2e/trash.spec.ts e2e/history.spec.ts`
Expected: PASS.
Existing tests that click menu items by role `button` now need role `menuitem`; update those selectors (search the e2e folder for `getByRole('button', { name: '` followed by a menu label, and `rowAction` in `e2e/helpers.ts`).

- [ ] **Step 13: Run everything and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all pass.

```bash
git add src/renderer/src/components src/renderer/src/styles/app.css e2e
git commit -m "Add a shared menu kit with keyboard navigation, submenus and search"
```

### Task 3: Turn into model

**Files:**
- Create: `src/renderer/src/editor/turnInto.ts`, `src/renderer/src/editor/turnInto.test.ts`

**Interfaces:**
- Produces:
  - `type TurnIntoId = 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'bullet' | 'numbered' | 'todo' | 'toggle' | 'toggleHeading1' | 'toggleHeading2' | 'toggleHeading3' | 'code' | 'quote' | 'callout' | 'math'`
  - `TURN_INTO: TurnIntoOption[]` with `{ id, label, hint?, type, props? }`
  - `currentTurnInto(block: TurnIntoBlock): TurnIntoId | null`
  - `canTurnInto(block: TurnIntoBlock): boolean`
  - `turnIntoUpdate(block: TurnIntoBlock, id: TurnIntoId): TurnIntoUpdate`
  - `interface TurnIntoBlock { type: string; props: Record<string, unknown>; content?: unknown }`
  - `interface TurnIntoUpdate { type: string; props: Record<string, unknown>; content?: string }`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/editor/turnInto.test.ts
import { describe, expect, it } from 'vitest'
import { canTurnInto, currentTurnInto, TURN_INTO, turnIntoUpdate } from './turnInto'

const text = (t: string): unknown[] => [{ type: 'text', text: t, styles: {} }]

describe('turn into', () => {
  it('lists Notion options in Notion order with their shortcuts', () => {
    expect(TURN_INTO.map((o) => o.label)).toEqual([
      'Text',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'To-do list',
      'Toggle list',
      'Toggle heading 1',
      'Toggle heading 2',
      'Toggle heading 3',
      'Code',
      'Quote',
      'Callout',
      'Block equation'
    ])
    expect(TURN_INTO.find((o) => o.id === 'toggle')?.hint).toBe('>')
  })

  it('names the current type, telling toggle headings apart', () => {
    expect(currentTurnInto({ type: 'heading', props: { level: 2 } })).toBe('heading2')
    expect(currentTurnInto({ type: 'heading', props: { level: 1, isToggleable: true } })).toBe(
      'toggleHeading1'
    )
    expect(currentTurnInto({ type: 'heading', props: { level: 5 } })).toBeNull()
    expect(currentTurnInto({ type: 'image', props: {} })).toBeNull()
  })

  it('only converts blocks with text', () => {
    expect(canTurnInto({ type: 'paragraph', props: {} })).toBe(true)
    expect(canTurnInto({ type: 'math', props: {} })).toBe(true)
    expect(canTurnInto({ type: 'table', props: {} })).toBe(false)
    expect(canTurnInto({ type: 'image', props: {} })).toBe(false)
  })

  it('keeps colours where the new type has them', () => {
    const block = { type: 'paragraph', props: { textColor: 'red', backgroundColor: 'yellow' } }
    expect(turnIntoUpdate(block, 'bullet')).toEqual({
      type: 'bulletListItem',
      props: { textColor: 'red', backgroundColor: 'yellow' }
    })
    expect(turnIntoUpdate(block, 'heading1').props).toEqual({
      textColor: 'red',
      backgroundColor: 'yellow',
      level: 1,
      isToggleable: false
    })
  })

  it('gives callouts a gray background unless the block had one', () => {
    expect(turnIntoUpdate({ type: 'paragraph', props: {} }, 'callout').props.backgroundColor).toBe(
      'gray'
    )
    expect(
      turnIntoUpdate({ type: 'paragraph', props: { backgroundColor: 'blue' } }, 'callout').props
        .backgroundColor
    ).toBe('blue')
  })

  it('moves text into code and equations and back out', () => {
    const para = { type: 'paragraph', props: {}, content: text('x^2') }
    expect(turnIntoUpdate(para, 'code')).toEqual({ type: 'codeBlock', props: {}, content: 'x^2' })
    expect(turnIntoUpdate(para, 'math')).toEqual({ type: 'math', props: { latex: 'x^2' } })
    expect(turnIntoUpdate({ type: 'math', props: { latex: 'y' } }, 'paragraph')).toEqual({
      type: 'paragraph',
      props: {},
      content: 'y'
    })
    expect(turnIntoUpdate({ type: 'codeBlock', props: {}, content: text('a') }, 'quote')).toEqual({
      type: 'quote',
      props: {},
      content: 'a'
    })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/renderer/src/editor/turnInto.test.ts`
Expected: FAIL, cannot resolve `./turnInto`.

- [ ] **Step 3: Implement the model**

```ts
// src/renderer/src/editor/turnInto.ts
import type { Inline } from '@shared/core/blocks'
import { inlineText } from '@shared/core/text'

export type TurnIntoId =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'toggle'
  | 'toggleHeading1'
  | 'toggleHeading2'
  | 'toggleHeading3'
  | 'code'
  | 'quote'
  | 'callout'
  | 'math'

export interface TurnIntoOption {
  id: TurnIntoId
  label: string
  /** Notion's Markdown shortcut for the type. */
  hint?: string
  type: string
  props?: Record<string, unknown>
}

export interface TurnIntoBlock {
  type: string
  props: Record<string, unknown>
  content?: unknown
}

export interface TurnIntoUpdate {
  type: string
  props: Record<string, unknown>
  content?: string
}

const heading = (level: number, isToggleable: boolean): Record<string, unknown> => ({
  level,
  isToggleable
})

export const TURN_INTO: TurnIntoOption[] = [
  { id: 'paragraph', label: 'Text', type: 'paragraph' },
  { id: 'heading1', label: 'Heading 1', hint: '#', type: 'heading', props: heading(1, false) },
  { id: 'heading2', label: 'Heading 2', hint: '##', type: 'heading', props: heading(2, false) },
  { id: 'heading3', label: 'Heading 3', hint: '###', type: 'heading', props: heading(3, false) },
  { id: 'bullet', label: 'Bulleted list', hint: '-', type: 'bulletListItem' },
  { id: 'numbered', label: 'Numbered list', hint: '1.', type: 'numberedListItem' },
  { id: 'todo', label: 'To-do list', hint: '[]', type: 'checkListItem' },
  { id: 'toggle', label: 'Toggle list', hint: '>', type: 'toggleListItem' },
  { id: 'toggleHeading1', label: 'Toggle heading 1', hint: '>#', type: 'heading', props: heading(1, true) },
  { id: 'toggleHeading2', label: 'Toggle heading 2', hint: '>##', type: 'heading', props: heading(2, true) },
  { id: 'toggleHeading3', label: 'Toggle heading 3', hint: '>###', type: 'heading', props: heading(3, true) },
  { id: 'code', label: 'Code', hint: '```', type: 'codeBlock' },
  { id: 'quote', label: 'Quote', hint: '"', type: 'quote' },
  { id: 'callout', label: 'Callout', type: 'callout' },
  { id: 'math', label: 'Block equation', type: 'math' }
]

const TEXT_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'quote',
  'callout'
])
// Code blocks keep plain text and equations keep LaTeX, so neither has colours or inline content.
const PLAIN_TYPES = new Set(['codeBlock', 'math'])

export function canTurnInto(block: TurnIntoBlock): boolean {
  return TEXT_TYPES.has(block.type) || PLAIN_TYPES.has(block.type)
}

export function currentTurnInto(block: TurnIntoBlock): TurnIntoId | null {
  if (block.type === 'heading') {
    const level = Number(block.props.level)
    if (level < 1 || level > 3) return null
    return `${block.props.isToggleable ? 'toggleHeading' : 'heading'}${level}` as TurnIntoId
  }
  return TURN_INTO.find((o) => o.type === block.type)?.id ?? null
}

function textOf(block: TurnIntoBlock): string {
  if (block.type === 'math') return String(block.props.latex ?? '')
  return Array.isArray(block.content) ? inlineText(block.content as Inline[]) : ''
}

export function turnIntoUpdate(block: TurnIntoBlock, id: TurnIntoId): TurnIntoUpdate {
  const option = TURN_INTO.find((o) => o.id === id)!
  if (option.type === 'math') return { type: 'math', props: { latex: textOf(block) } }
  const colors: Record<string, unknown> = {}
  if (TEXT_TYPES.has(option.type)) {
    if (block.props.textColor !== undefined) colors.textColor = block.props.textColor
    if (block.props.backgroundColor !== undefined) colors.backgroundColor = block.props.backgroundColor
  }
  if (option.type === 'callout' && (!colors.backgroundColor || colors.backgroundColor === 'default')) {
    colors.backgroundColor = 'gray'
  }
  const update: TurnIntoUpdate = { type: option.type, props: { ...colors, ...option.props } }
  if (PLAIN_TYPES.has(block.type) || option.type === 'codeBlock') update.content = textOf(block)
  return update
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run src/renderer/src/editor/turnInto.test.ts`
Expected: PASS.
Note: turning a styled paragraph into code drops its inline styles, as Notion does.

- [ ] **Step 5: Commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/renderer/src/editor/turnInto.ts src/renderer/src/editor/turnInto.test.ts
git commit -m "Add the Turn into options and block updates"
```

### Task 4: Notion slash menu

**Files:**
- Create: `src/renderer/src/editor/menus/SlashMenu.tsx`, `e2e/slash.spec.ts`
- Modify: `src/renderer/src/editor/slashItems.tsx`, `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/editor/editor.css`

**Interfaces:**
- Consumes: menu kit CSS classes from Task 2 (`menu`, `menu-item`, `menu-item-icon`, `menu-item-label`, `menu-item-hint`, `menu-section`, `menu-empty`).
- Produces: `type SlashItem = DefaultReactSuggestionItem & { key: string; hint?: string }`, `getSlashItems(editor, opts): SlashItem[]`, `querySlashItems(editor, opts, query): Promise<SlashItem[]>`, `SlashMenu` component.

- [ ] **Step 1: Write the failing end-to-end test**

```ts
// e2e/slash.spec.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, newPage, waitForFile } from './helpers'

test('the slash menu looks like Notion', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Slash')
  await page.keyboard.type('/')
  const menu = page.locator('.slash-menu')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.menu-section').first()).toHaveText('Basic blocks')
  const items = menu.locator('.menu-item')
  await expect(items.first().locator('.menu-item-label')).toHaveText('Text')
  await expect(menu.getByRole('option', { name: /Heading 1/ }).locator('.menu-item-hint')).toHaveText('#')
  await expect(menu.getByRole('option', { name: /To-do list/ }).locator('.menu-item-hint')).toHaveText('[]')
  const heights = await items.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
  expect(heights.every((h) => h === 28)).toBe(true)
  await expect(menu).not.toContainText('⌘')
  await expect(menu.locator('.slash-menu-footer')).toContainText("Type '/' on the page")
  expect((await menu.boundingBox())!.width).toBe(324)
})

test('typing filters and Enter turns the block into the choice', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Filter')
  await page.keyboard.type('/head')
  await expect(page.locator('.slash-menu .menu-item-label')).toHaveText([
    'Heading 1',
    'Heading 2',
    'Heading 3',
    'Toggle heading 1',
    'Toggle heading 2',
    'Toggle heading 3'
  ])
  await page.keyboard.press('Enter')
  await page.keyboard.type('Title')
  await waitForFile(join(nb.workspace, 'Filter.md'), '# Title')
})

test('no results, then a space, closes the menu like Notion', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Nothing')
  await page.keyboard.type('/zzzz')
  await expect(page.locator('.slash-menu .menu-empty')).toHaveText('No results')
  await page.keyboard.type(' ')
  await expect(page.locator('.slash-menu')).toBeHidden()
  await expect(page.locator(editor)).toContainText('/zzzz')
})

test('the menu flips above the cursor at the bottom of the window', async ({ nb }) => {
  const body = Array.from({ length: 80 }, (_, i) => `Line ${i}`).join('\n\n') + '\n'
  await writeFile(join(nb.workspace, 'Long.md'), body)
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Long').click()
  const last = page.locator(`${editor} .bn-block-content`).last()
  await last.scrollIntoViewIfNeeded()
  await last.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  const box = (await page.locator('.slash-menu').boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  expect(box.y).toBeGreaterThanOrEqual(0)
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:e2e e2e/slash.spec.ts`
Expected: FAIL, `.slash-menu` does not exist.

- [ ] **Step 3: Rewrite the slash items with Notion's labels, hints and order**

Replace `getSlashItems` and `querySlashItems` in `src/renderer/src/editor/slashItems.tsx` (keep `insertPageLink`, `SlashItemOptions` and the imports it needs):

```tsx
export type SlashItem = DefaultReactSuggestionItem & { key: string; hint?: string }

const LABELS: Record<string, { title: string; hint?: string; aliases?: string[] }> = {
  paragraph: { title: 'Text', aliases: ['text', 'plain'] },
  heading: { title: 'Heading 1', hint: '#' },
  heading_2: { title: 'Heading 2', hint: '##' },
  heading_3: { title: 'Heading 3', hint: '###' },
  bullet_list: { title: 'Bulleted list', hint: '-' },
  numbered_list: { title: 'Numbered list', hint: '1.' },
  check_list: { title: 'To-do list', hint: '[]', aliases: ['todo', 'task', 'checkbox'] },
  toggle_list: { title: 'Toggle list', hint: '>' },
  quote: { title: 'Quote', hint: '"' },
  divider: { title: 'Divider', hint: '---' },
  code_block: { title: 'Code', hint: '```' },
  table: { title: 'Table' },
  toggle_heading: { title: 'Toggle heading 1', hint: '>#' },
  toggle_heading_2: { title: 'Toggle heading 2', hint: '>##' },
  toggle_heading_3: { title: 'Toggle heading 3', hint: '>###' },
  image: { title: 'Image' },
  video: { title: 'Video' },
  audio: { title: 'Audio' },
  file: { title: 'File' },
  two_columns: { title: '2 columns' },
  three_columns: { title: '3 columns' }
}

const ORDER: { group: string; keys: string[] }[] = [
  {
    group: 'Basic blocks',
    keys: [
      'paragraph',
      'page',
      'check_list',
      'heading',
      'heading_2',
      'heading_3',
      'table',
      'bullet_list',
      'numbered_list',
      'toggle_list',
      'quote',
      'divider',
      'callout',
      'code_block'
    ]
  },
  { group: 'Media', keys: ['image', 'video', 'audio', 'file'] },
  {
    group: 'Advanced',
    keys: [
      'toc',
      'math',
      'toggle_heading',
      'toggle_heading_2',
      'toggle_heading_3',
      'two_columns',
      'three_columns'
    ]
  }
]

function customItems(editor: AppEditor, opts: SlashItemOptions): SlashItem[] {
  return [
    {
      key: 'page',
      title: 'Page',
      aliases: ['page', 'subpage', 'link'],
      icon: <span>📄</span>,
      onItemClick: () => void insertPageLink(editor, opts.createSubPage)
    },
    {
      key: 'callout',
      title: 'Callout',
      aliases: ['callout', 'note', 'info', 'tip'],
      icon: <span>💡</span>,
      // Converting a paragraph would otherwise carry over its "default" background.
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, { type: 'callout', props: { backgroundColor: 'gray' } })
    },
    {
      key: 'toc',
      title: 'Table of contents',
      aliases: ['toc', 'outline', 'contents'],
      icon: <TocIcon size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'toc' })
    },
    {
      key: 'math',
      title: 'Block equation',
      aliases: ['math', 'equation', 'latex', 'tex', 'katex'],
      icon: <span>∑</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'math' })
    }
  ]
}

export function getSlashItems(editor: AppEditor, opts: SlashItemOptions): SlashItem[] {
  const byKey = new Map<string, SlashItem>()
  for (const item of getDefaultReactSlashMenuItems(editor) as KeyedItem[]) {
    if (item.key) byKey.set(item.key, { ...item, key: item.key })
  }
  // The multi-column package's items carry no key; it returns two columns, then three.
  const [two, three] = getMultiColumnSlashMenuItems(editor)
  if (two) byKey.set('two_columns', { ...two, key: 'two_columns' })
  if (three) byKey.set('three_columns', { ...three, key: 'three_columns' })
  for (const item of customItems(editor, opts)) byKey.set(item.key, item)
  return ORDER.flatMap(({ group, keys }) =>
    keys.flatMap((key) => {
      const item = byKey.get(key)
      if (!item) return []
      const label = LABELS[key]
      return [
        {
          ...item,
          group,
          title: label?.title ?? item.title,
          hint: label?.hint,
          aliases: [...(item.aliases ?? []), item.title.toLowerCase(), ...(label?.aliases ?? [])],
          badge: undefined,
          subtext: undefined
        }
      ]
    })
  )
}

export async function querySlashItems(
  editor: AppEditor,
  opts: SlashItemOptions,
  query: string
): Promise<SlashItem[]> {
  return filterSuggestionItems(getSlashItems(editor, opts), query)
}
```

Remove the now-unused `EXCLUDED_KEYS`, `groupAdjacent` and `combineByGroup` import.

- [ ] **Step 4: Implement the slash menu component**

```tsx
// src/renderer/src/editor/menus/SlashMenu.tsx
import { SuggestionMenu } from '@blocknote/core/extensions'
import { useExtension, useExtensionState, type SuggestionMenuProps } from '@blocknote/react'
import { Fragment, useEffect, useRef } from 'react'
import type { SlashItem } from '../slashItems'

export function SlashMenu({
  items,
  selectedIndex,
  onItemClick,
  loadingState
}: SuggestionMenuProps<SlashItem>): React.JSX.Element {
  const menu = useExtension(SuggestionMenu)
  const query = useExtensionState(SuggestionMenu, { selector: (s) => s?.query ?? '' })
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (loadingState === 'loaded' && items.length === 0 && query.endsWith(' ')) menu.closeMenu()
  }, [items.length, loadingState, query, menu])

  useEffect(() => {
    list.current?.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div className="menu slash-menu" role="listbox" id="bn-suggestion-menu">
      <div className="slash-menu-list" ref={list}>
        {items.length === 0 && loadingState === 'loaded' && (
          <div className="menu-empty">No results</div>
        )}
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {item.group !== items[i - 1]?.group && <div className="menu-section">{item.group}</div>}
            <button
              type="button"
              role="option"
              id={`bn-suggestion-menu-item-${i}`}
              aria-selected={i === selectedIndex}
              className={`menu-item ${i === selectedIndex ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onItemClick?.(item)}
            >
              <span className="menu-item-icon">{item.icon}</span>
              <span className="menu-item-label">{item.title}</span>
              {item.hint && <span className="menu-item-hint">{item.hint}</span>}
            </button>
          </Fragment>
        ))}
      </div>
      <div className="slash-menu-footer">
        <span>Type &apos;/&apos; on the page</span>
        <span>esc</span>
      </div>
    </div>
  )
}
```

Check the id format against `node_modules/@blocknote/react/src/components/SuggestionMenu/getSuggestionMenuItemId.ts` and use that function instead if it is exported.

- [ ] **Step 5: Use it in the editor and style it**

In `Editor.tsx`:

```tsx
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={(query) =>
                querySlashItems(editor, { createSubPage: props.createSubPage }, query)
              }
              suggestionMenuComponent={SlashMenu}
            />
```

Append to `editor.css`:

```css
/* ---------- Slash menu ---------- */
.menu.slash-menu {
  position: static;
  width: 324px;
  max-width: none;
  padding: 0;
  overflow: hidden;
}
.slash-menu-list {
  max-height: min(40vh, 380px);
  overflow-y: auto;
  padding: 4px;
}
.slash-menu .menu-item:hover {
  background: var(--hover);
}
.slash-menu-footer {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  border-top: 1px solid var(--divider);
  font-size: 12px;
  color: var(--text-tertiary);
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test:e2e e2e/slash.spec.ts e2e/app.spec.ts`
Expected: PASS.
If the flip test fails, pass `floatingUIOptions` to the controller with `flip()` and `shift()` from `@floating-ui/react` (check what `SuggestionMenuController` uses by default in `node_modules/@blocknote/react/src/components/SuggestionMenu/SuggestionMenuController.tsx`).
Existing tests that clicked slash items by their old titles ("Paragraph", "Bullet List", "Check List") need the new titles.

- [ ] **Step 7: Run everything and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`

```bash
git add src/renderer/src/editor e2e
git commit -m "Replace the slash menu with Notion's compact, grouped menu"
```

### Task 5: Block menu, side buttons and block selection

**Files:**
- Create: `src/renderer/src/editor/useAppEditor.ts`, `src/renderer/src/editor/blockSelection.ts`, `src/renderer/src/editor/blockActions.ts`, `src/renderer/src/editor/menus/entries.tsx`, `src/renderer/src/editor/menus/BlockMenu.tsx`, `src/renderer/src/editor/menus/AppSideMenu.tsx`, `e2e/blockmenu.spec.ts`
- Modify: `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/editor/editor.css`

**Interfaces:**
- Consumes: `Menu`, `MenuEntry` (Task 2); `TURN_INTO`, `currentTurnInto`, `canTurnInto`, `turnIntoUpdate`, `TurnIntoId` (Task 3); icons from Task 2.
- Produces:
  - `useAppEditor(): AppEditor`
  - `blockSelection` (BlockNote extension), `selectBlocks(editor: AppEditor, ids: string[]): void`, `selectedBlockIds(editor: AppEditor): string[]`
  - `turnIntoBlocks(editor, ids: string[], id: TurnIntoId): void`, `colorBlocks(editor, ids, prop: 'textColor' | 'backgroundColor', color: string): void`, `duplicateBlocks(editor, ids): string[]`, `deleteBlocks(editor, ids): void`
  - `turnIntoEntries(editor, blocks): MenuEntry[]`, `colorEntries(editor, blocks): MenuEntry[]`, `blockMenuEntries(editor, blocks): MenuEntry[]`, `blockLabel(block): string`
  - `BlockMenuContext` with `{ open(ids: string[], anchor: DOMRect): void }`, `BlockMenuHost`
  - `AppSideMenu`

- [ ] **Step 1: Write the failing end-to-end test**

```ts
// e2e/blockmenu.spec.ts
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { editor, openFile, waitForFile } from './helpers'

async function openBlockMenu(page: Page, text: string): Promise<void> {
  await page.locator(`${editor} .bn-block-content`, { hasText: text }).first().hover()
  await page.getByRole('button', { name: 'Block menu' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

test('the handle selects the block and opens the menu with search focused', async ({ nb }) => {
  const page = await openFile(nb, 'Menu', 'First\n\nSecond\n')
  await openBlockMenu(page, 'Second')
  await expect(page.getByPlaceholder('Search actions…')).toBeFocused()
  await expect(page.getByRole('menu').locator('.menu-section').first()).toHaveText('Text')
  const selected = page.locator(`${editor} .nb-block-selected`)
  await expect(selected).toHaveCount(1)
  await expect(selected).toContainText('Second')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(selected).toHaveCount(0)
})

test('Turn into from the submenu', async ({ nb }) => {
  const page = await openFile(nb, 'Turn', 'Make me a heading\n')
  await openBlockMenu(page, 'Make me')
  await page.getByRole('menuitem', { name: 'Turn into' }).hover()
  await page.getByRole('menuitem', { name: 'Heading 1' }).click()
  await waitForFile(join(nb.workspace, 'Turn.md'), '# Make me a heading')
})

test('search finds Turn into options and colours from the keyboard', async ({ nb }) => {
  const page = await openFile(nb, 'Search', 'Quote me\n\nColor me\n')
  await openBlockMenu(page, 'Quote me')
  await page.keyboard.type('quote')
  await page.keyboard.press('Enter')
  await openBlockMenu(page, 'Color me')
  await page.keyboard.type('red back')
  await expect(page.getByRole('menu').locator('.menu-item.active')).toHaveText('Red background')
  await page.keyboard.press('Enter')
  const text = await waitForFile(join(nb.workspace, 'Search.md'), '> Quote me')
  expect(text).toContain('Color me')
  await waitForFile(join(nb.workspace, 'Search.md'), 'Color me<!-- bg=red -->')
})

test('Turn into keeps children and colours', async ({ nb }) => {
  const page = await openFile(
    nb,
    'Keep',
    'Parent<!-- color=red -->\n\n<div data-children>\n\nChild\n\n</div>\n'
  )
  await openBlockMenu(page, 'Parent')
  await page.keyboard.type('bulleted')
  await page.keyboard.press('Enter')
  const block = page.locator(`${editor} .bn-block-content[data-content-type="bulletListItem"]`)
  await expect(block).toHaveAttribute('data-text-color', 'red')
  await expect(page.locator(`${editor} .bn-block-group .bn-block-group`)).toContainText('Child')
})

test('Duplicate and Delete', async ({ nb }) => {
  const page = await openFile(nb, 'Dup', 'Only once\n')
  await openBlockMenu(page, 'Only once')
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.locator(`${editor} .bn-block-content`, { hasText: 'Only once' })).toHaveCount(2)
  await openBlockMenu(page, 'Only once')
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.locator(`${editor} .bn-block-content`, { hasText: 'Only once' })).toHaveCount(1)
})

test('+ adds a block below and opens the slash menu; Option-click adds above', async ({ nb }) => {
  const page = await openFile(nb, 'Plus', 'Anchor\n')
  const anchor = page.locator(`${editor} .bn-block-content`, { hasText: 'Anchor' })
  await anchor.hover()
  await page.getByRole('button', { name: 'Add a block below' }).click()
  await expect(page.locator('.slash-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.type('below')
  await anchor.hover()
  await page.getByRole('button', { name: 'Add a block below' }).click({ modifiers: ['Alt'] })
  await page.keyboard.press('Escape')
  await page.keyboard.type('above')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText([
    /above/,
    /Anchor/,
    /below/
  ])
})
```

Block colours are written as a trailing comment, such as `Colored<!-- color=red bg=yellow -->` (see `src/shared/core/html.ts`).

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:e2e e2e/blockmenu.spec.ts`
Expected: FAIL, there is no "Block menu" button.

- [ ] **Step 3: Add the typed editor hook**

```ts
// src/renderer/src/editor/useAppEditor.ts
import { useBlockNoteEditor } from '@blocknote/react'
import type { AppEditor, AppSchema } from './schema'

export function useAppEditor(): AppEditor {
  return useBlockNoteEditor<
    AppSchema['blockSchema'],
    AppSchema['inlineContentSchema'],
    AppSchema['styleSchema']
  >() as AppEditor
}
```

- [ ] **Step 4: Implement block selection**

```ts
// src/renderer/src/editor/blockSelection.ts
import { createExtension } from '@blocknote/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { AppEditor } from './schema'

const key = new PluginKey<string[]>('nbBlockSelection')

export function selectedBlockIds(editor: AppEditor): string[] {
  return key.getState(editor.prosemirrorState) ?? []
}

export function selectBlocks(editor: AppEditor, ids: string[]): void {
  const view = editor.prosemirrorView
  view.dispatch(view.state.tr.setMeta(key, ids))
}

export const blockSelection = createExtension({
  key: 'nbBlockSelection',
  prosemirrorPlugins: [
    new Plugin<string[]>({
      key,
      state: {
        init: () => [],
        apply: (tr, ids) => {
          const next = tr.getMeta(key) as string[] | undefined
          if (next) return next
          // Any edit or caret move ends a block selection, as in Notion.
          return ids.length && (tr.docChanged || tr.selectionSet) ? [] : ids
        }
      },
      props: {
        decorations: (state) => {
          const ids = new Set(key.getState(state))
          if (ids.size === 0) return null
          const decorations: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'blockContainer' || !ids.has(node.attrs.id)) return true
            decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'nb-block-selected' }))
            return false
          })
          return DecorationSet.create(state.doc, decorations)
        },
        attributes: (state): Record<string, string> =>
          key.getState(state)?.length ? { class: 'nb-has-block-selection' } : {},
        handleDOMEvents: {
          mousedown: (view) => {
            if (key.getState(view.state)?.length) view.dispatch(view.state.tr.setMeta(key, []))
            return false
          }
        }
      }
    })
  ]
})
```

- [ ] **Step 5: Implement the block actions**

```ts
// src/renderer/src/editor/blockActions.ts
import type { AppBlock, AppEditor, AppPartialBlock } from './schema'
import { canTurnInto, turnIntoUpdate, type TurnIntoId } from './turnInto'

export function blocksOf(editor: AppEditor, ids: string[]): AppBlock[] {
  return ids.map((id) => editor.getBlock(id)).filter((b): b is AppBlock => b !== undefined)
}

export function turnIntoBlocks(editor: AppEditor, ids: string[], id: TurnIntoId): void {
  editor.transact(() => {
    for (const block of blocksOf(editor, ids)) {
      if (canTurnInto(block)) {
        editor.updateBlock(block, turnIntoUpdate(block, id) as unknown as AppPartialBlock)
      }
    }
  })
}

export function colorBlocks(
  editor: AppEditor,
  ids: string[],
  prop: 'textColor' | 'backgroundColor',
  color: string
): void {
  editor.transact(() => {
    for (const block of blocksOf(editor, ids)) {
      if (prop in block.props) {
        editor.updateBlock(block, { props: { [prop]: color } } as unknown as AppPartialBlock)
      }
    }
  })
}

function copyOf(block: AppBlock): AppPartialBlock {
  return {
    type: block.type,
    props: block.props,
    content: block.content,
    children: block.children.map(copyOf)
  } as unknown as AppPartialBlock
}

/** Inserts copies after the last block and returns their ids. */
export function duplicateBlocks(editor: AppEditor, ids: string[]): string[] {
  const blocks = blocksOf(editor, ids)
  if (blocks.length === 0) return []
  return editor.insertBlocks(blocks.map(copyOf), blocks[blocks.length - 1], 'after').map((b) => b.id)
}

export function deleteBlocks(editor: AppEditor, ids: string[]): void {
  const blocks = blocksOf(editor, ids)
  if (blocks.length) editor.removeBlocks(blocks)
}
```

- [ ] **Step 6: Implement the shared menu entries**

```tsx
// src/renderer/src/editor/menus/entries.tsx
import { COLOR_NAMES } from '@shared/core/blocks'
import type { MenuEntry } from '../../components/menu/model'
import { DuplicateIcon, PaletteIcon, TrashIcon, TurnIntoIcon } from '../../components/icons'
import { colorBlocks, deleteBlocks, duplicateBlocks, turnIntoBlocks } from '../blockActions'
import type { AppBlock, AppEditor } from '../schema'
import { canTurnInto, currentTurnInto, TURN_INTO } from '../turnInto'

const NAMES: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  file: 'File',
  table: 'Table',
  divider: 'Divider',
  pageLink: 'Page',
  toc: 'Table of contents',
  columnList: 'Columns',
  column: 'Column',
  raw: 'Markdown'
}

const capital = (s: string): string => s[0].toUpperCase() + s.slice(1)

export function blockLabel(block: AppBlock): string {
  const id = currentTurnInto(block)
  return (id && TURN_INTO.find((o) => o.id === id)?.label) || NAMES[block.type] || 'Block'
}

export function turnIntoEntries(editor: AppEditor, blocks: AppBlock[]): MenuEntry[] {
  const current = blocks.length === 1 ? currentTurnInto(blocks[0]) : null
  const ids = blocks.map((b) => b.id)
  return TURN_INTO.map((option) => ({
    kind: 'item',
    id: `turn-${option.id}`,
    label: option.label,
    hint: option.hint,
    checked: option.id === current,
    onSelect: () => turnIntoBlocks(editor, ids, option.id)
  }))
}

export function colorEntries(editor: AppEditor, blocks: AppBlock[]): MenuEntry[] {
  const ids = blocks.map((b) => b.id)
  const text = (color: string, label: string): MenuEntry => ({
    kind: 'item',
    id: `text-${color}`,
    label,
    keywords: ['color', 'text'],
    icon: <span className="menu-color" data-text={color}>A</span>,
    onSelect: () => colorBlocks(editor, ids, 'textColor', color)
  })
  const background = (color: string, label: string): MenuEntry => ({
    kind: 'item',
    id: `bg-${color}`,
    label,
    keywords: ['color'],
    icon: <span className="menu-color" data-bg={color} />,
    onSelect: () => colorBlocks(editor, ids, 'backgroundColor', color)
  })
  return [
    { kind: 'section', label: 'Text color' },
    text('default', 'Default'),
    ...COLOR_NAMES.map((c) => text(c, capital(c))),
    { kind: 'section', label: 'Background color' },
    background('default', 'Default background'),
    ...COLOR_NAMES.map((c) => background(c, `${capital(c)} background`))
  ]
}

export function blockMenuEntries(editor: AppEditor, blocks: AppBlock[]): MenuEntry[] {
  const ids = blocks.map((b) => b.id)
  const entries: MenuEntry[] = []
  if (blocks.every(canTurnInto)) {
    entries.push({
      kind: 'item',
      id: 'turn-into',
      label: 'Turn into',
      icon: <TurnIntoIcon size={16} />,
      submenu: turnIntoEntries(editor, blocks)
    })
  }
  if (blocks.every((b) => 'textColor' in b.props || 'backgroundColor' in b.props)) {
    entries.push({
      kind: 'item',
      id: 'color',
      label: 'Color',
      icon: <PaletteIcon size={16} />,
      submenu: colorEntries(editor, blocks)
    })
  }
  if (entries.length) entries.push({ kind: 'separator' })
  entries.push(
    {
      kind: 'item',
      id: 'duplicate',
      label: 'Duplicate',
      hint: '⌘D',
      icon: <DuplicateIcon size={16} />,
      onSelect: () => duplicateBlocks(editor, ids)
    },
    {
      kind: 'item',
      id: 'delete',
      label: 'Delete',
      hint: 'Del',
      danger: true,
      icon: <TrashIcon size={16} />,
      onSelect: () => deleteBlocks(editor, ids)
    }
  )
  return entries
}
```

- [ ] **Step 7: Implement the block menu host and the side buttons**

```tsx
// src/renderer/src/editor/menus/BlockMenu.tsx
import { SideMenuExtension } from '@blocknote/core/extensions'
import { useExtension } from '@blocknote/react'
import { createContext, useMemo, useState, type ReactNode } from 'react'
import { Menu } from '../../components/menu/Menu'
import { blocksOf } from '../blockActions'
import { selectBlocks } from '../blockSelection'
import { useAppEditor } from '../useAppEditor'
import { blockLabel, blockMenuEntries } from './entries'

export interface BlockMenuApi {
  open(ids: string[], anchor: DOMRect): void
}

export const BlockMenuContext = createContext<BlockMenuApi>({ open: () => {} })

export function BlockMenuHost({ children }: { children: ReactNode }): React.JSX.Element {
  const editor = useAppEditor()
  const sideMenu = useExtension(SideMenuExtension)
  const [state, setState] = useState<{ ids: string[]; anchor: DOMRect } | null>(null)

  const api = useMemo<BlockMenuApi>(
    () => ({
      open: (ids, anchor) => {
        sideMenu.freezeMenu()
        selectBlocks(editor, ids)
        setState({ ids, anchor })
      }
    }),
    [editor, sideMenu]
  )

  const close = (): void => {
    setState(null)
    sideMenu.unfreezeMenu()
    selectBlocks(editor, [])
    editor.focus()
  }

  const blocks = state ? blocksOf(editor, state.ids) : []
  return (
    <BlockMenuContext.Provider value={api}>
      {children}
      {state && blocks.length > 0 && (
        <Menu
          anchor={state.anchor}
          entries={blockMenuEntries(editor, blocks)}
          header={blocks.length === 1 ? blockLabel(blocks[0]) : `${blocks.length} blocks`}
          search="Search actions…"
          onClose={close}
        />
      )}
    </BlockMenuContext.Provider>
  )
}
```

```tsx
// src/renderer/src/editor/menus/AppSideMenu.tsx
import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import { SideMenu, useExtension, useExtensionState } from '@blocknote/react'
import { useContext } from 'react'
import { DragIcon, PlusIcon } from '../../components/icons'
import { useAppEditor } from '../useAppEditor'
import { BlockMenuContext } from './BlockMenu'

export function AppSideMenu(): React.JSX.Element {
  const editor = useAppEditor()
  const sideMenu = useExtension(SideMenuExtension)
  const suggestionMenu = useExtension(SuggestionMenu)
  const block = useExtensionState(SideMenuExtension, { selector: (s) => s?.block })
  const blockMenu = useContext(BlockMenuContext)
  return (
    <SideMenu>
      <>
        {block && (
          <>
            <button
              type="button"
              className="nb-side-button"
              aria-label="Add a block below"
              title="Click to add below. Option-click to add above."
              onClick={(e) => {
                const empty = Array.isArray(block.content) && block.content.length === 0
                const target =
                  empty && !e.altKey
                    ? block
                    : editor.insertBlocks([{ type: 'paragraph' }], block, e.altKey ? 'before' : 'after')[0]
                editor.setTextCursorPosition(target)
                suggestionMenu.openSuggestionMenu('/')
              }}
            >
              <PlusIcon size={18} />
            </button>
            <button
              type="button"
              className="nb-side-button nb-drag-handle"
              aria-label="Block menu"
              title="Drag to move. Click to open menu."
              draggable
              onDragStart={(e) => sideMenu.blockDragStart(e, block)}
              onDragEnd={() => sideMenu.blockDragEnd()}
              onClick={(e) => blockMenu.open([block.id], e.currentTarget.getBoundingClientRect())}
            >
              <DragIcon size={16} />
            </button>
          </>
        )}
      </>
    </SideMenu>
  )
}
```

- [ ] **Step 8: Wire them into the editor**

In `Editor.tsx`: add `blockSelection` to `extensions`, pass `sideMenu={false}` to `BlockNoteView`, and wrap the controllers:

```tsx
            <BlockMenuHost>
              <SuggestionMenuController ... />
              <SideMenuController sideMenu={AppSideMenu} />
              <FormattingToolbarController formattingToolbar={AppFormattingToolbar} />
              <LinkToolbarController linkToolbar={AppLinkToolbar} />
              <HighlightShortcut color={props.lastColor ?? DEFAULT_COLOR} />
            </BlockMenuHost>
```

Import `SideMenuController` from `@blocknote/react`.

- [ ] **Step 9: Style the side buttons, block selection and colour swatches**

Append to `editor.css`:

```css
/* ---------- Side buttons and block selection ---------- */
.nb-side-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--nb-muted);
  cursor: pointer;
}
.nb-side-button:hover {
  background-color: var(--bn-colors-hovered-background);
}
.nb-drag-handle {
  width: 18px;
  cursor: grab;
}
.bn-root .bn-block-outer.nb-block-selected > .bn-block {
  background-color: var(--selected);
  border-radius: 4px;
}
.bn-root .bn-editor.nb-has-block-selection {
  caret-color: transparent;
}

.menu-color {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px var(--divider);
  font-weight: 500;
  color: var(--text);
}
.menu-color[data-text='gray'] { color: var(--color-gray); }
.menu-color[data-text='brown'] { color: var(--color-brown); }
.menu-color[data-text='orange'] { color: var(--color-orange); }
.menu-color[data-text='yellow'] { color: var(--color-yellow); }
.menu-color[data-text='green'] { color: var(--color-green); }
.menu-color[data-text='blue'] { color: var(--color-blue); }
.menu-color[data-text='purple'] { color: var(--color-purple); }
.menu-color[data-text='pink'] { color: var(--color-pink); }
.menu-color[data-text='red'] { color: var(--color-red); }
.menu-color[data-bg='gray'] { background: var(--bg-gray); }
.menu-color[data-bg='brown'] { background: var(--bg-brown); }
.menu-color[data-bg='orange'] { background: var(--bg-orange); }
.menu-color[data-bg='yellow'] { background: var(--bg-yellow); }
.menu-color[data-bg='green'] { background: var(--bg-green); }
.menu-color[data-bg='blue'] { background: var(--bg-blue); }
.menu-color[data-bg='purple'] { background: var(--bg-purple); }
.menu-color[data-bg='pink'] { background: var(--bg-pink); }
.menu-color[data-bg='red'] { background: var(--bg-red); }
```

Run `pnpm format` afterwards so Prettier expands the one-line rules.

- [ ] **Step 10: Run the tests**

Run: `pnpm test:e2e e2e/blockmenu.spec.ts e2e/app.spec.ts`
Expected: PASS.
If `.nb-block-selected` lands on a different element than `.bn-block-outer`, inspect the decorated element and adjust the CSS selector, not the test.
Existing tests that used BlockNote's drag handle (`[data-test="dragHandle"]`) or its "Delete" item need the new button and menu item.

- [ ] **Step 11: Run everything and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`

```bash
git add src/renderer/src/editor e2e
git commit -m "Add Notion's block menu with Turn into, Color, Duplicate and Delete"
```

### Task 6: Selection toolbar

**Files:**
- Create: `src/renderer/src/editor/menus/TurnIntoButton.tsx`, `e2e/toolbar.spec.ts`
- Modify: `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/editor/editor.css`

**Interfaces:**
- Consumes: `Menu` (Task 2), `turnIntoEntries` (Task 5), `canTurnInto`, `currentTurnInto`, `TURN_INTO` (Task 3), `useAppEditor` (Task 5).
- Produces: `TurnIntoButton`.

- [ ] **Step 1: Write the failing end-to-end test**

```ts
// e2e/toolbar.spec.ts
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, openFile, waitForFile } from './helpers'

test('the selection toolbar has Notion buttons in Notion order', async ({ nb }) => {
  const page = await openFile(nb, 'Bar', 'Select these words\n')
  await page.locator(`${editor} .bn-inline-content`).first().dblclick()
  const toolbar = page.locator('.bn-formatting-toolbar')
  await expect(toolbar).toBeVisible()
  const names = await toolbar
    .locator('button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim()))
  expect(names).toEqual([
    'Turn into',
    'Create link',
    'Bold',
    'Italic',
    'Underline',
    'Strike',
    'Code',
    'Colors'
  ])
  await expect(toolbar.getByRole('button', { name: 'Turn into' })).toHaveText(/Text/)
})

test('Turn into from the toolbar', async ({ nb }) => {
  const page = await openFile(nb, 'TurnBar', 'Promote me\n')
  await page.locator(`${editor} .bn-inline-content`).first().dblclick()
  await page.locator('.bn-formatting-toolbar').getByRole('button', { name: 'Turn into' }).click()
  await page.getByRole('menuitem', { name: 'Heading 2' }).click()
  await waitForFile(join(nb.workspace, 'TurnBar.md'), '## Promote me')
})

test('toolbar buttons show their shortcut', async ({ nb }) => {
  const page = await openFile(nb, 'Tips', 'Hover the bold button\n')
  await page.locator(`${editor} .bn-inline-content`).first().dblclick()
  await page.locator('.bn-formatting-toolbar').getByRole('button', { name: 'Bold' }).hover()
  await expect(page.getByRole('tooltip')).toContainText('⌘B')
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:e2e e2e/toolbar.spec.ts`
Expected: FAIL, the names include the block type select, text alignment and nesting buttons.

- [ ] **Step 3: Implement the Turn into button**

```tsx
// src/renderer/src/editor/menus/TurnIntoButton.tsx
import { useComponentsContext, useSelectedBlocks } from '@blocknote/react'
import { useState } from 'react'
import { ChevronDownIcon } from '../../components/icons'
import { Menu } from '../../components/menu/Menu'
import type { AppBlock } from '../schema'
import { canTurnInto, currentTurnInto, TURN_INTO } from '../turnInto'
import { useAppEditor } from '../useAppEditor'
import { turnIntoEntries } from './entries'

export function TurnIntoButton(): React.JSX.Element | null {
  const Components = useComponentsContext()!
  const editor = useAppEditor()
  const blocks = useSelectedBlocks(editor) as AppBlock[]
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  if (blocks.length === 0 || !blocks.every(canTurnInto)) return null
  const current = currentTurnInto(blocks[0])
  const label = TURN_INTO.find((o) => o.id === current)?.label ?? 'Text'
  return (
    <>
      <Components.FormattingToolbar.Button
        className="bn-button nb-turn-into-button"
        label="Turn into"
        mainTooltip="Turn into"
        isSelected={anchor !== null}
        onClick={(e) => setAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())}
      >
        {label}
        <ChevronDownIcon size={12} />
      </Components.FormattingToolbar.Button>
      {anchor && (
        <Menu anchor={anchor} entries={turnIntoEntries(editor, blocks)} onClose={() => setAnchor(null)} />
      )}
    </>
  )
}
```

- [ ] **Step 4: Rebuild the toolbar**

Replace `AppFormattingToolbar` in `Editor.tsx`:

```tsx
// File buttons only show for file blocks; text alignment, nesting and the block type select are not Notion's.
const TOOLBAR_KEYS = [
  'tableCellMergeButton',
  'fileCaptionButton',
  'replaceFileButton',
  'fileRenameButton',
  'fileDeleteButton',
  'fileDownloadButton',
  'filePreviewButton'
]

function AppFormattingToolbar(): React.JSX.Element {
  const defaults = new Map(getFormattingToolbarItems().map((item) => [String(item.key), item]))
  return (
    <FormattingToolbar>
      <TurnIntoButton key="turnInto" />
      {TOOLBAR_KEYS.map((key) => defaults.get(key))}
      <AppCreateLinkButton key="createLinkButton" />
      <BasicTextStyleButton basicTextStyle="bold" key="bold" />
      <BasicTextStyleButton basicTextStyle="italic" key="italic" />
      <BasicTextStyleButton basicTextStyle="underline" key="underline" />
      <BasicTextStyleButton basicTextStyle="strike" key="strike" />
      <BasicTextStyleButton basicTextStyle="code" key="code" />
      <AppColorStyleButton key="colorStyleButton" />
    </FormattingToolbar>
  )
}
```

Import `BasicTextStyleButton` from `@blocknote/react` and `TurnIntoButton` from `./menus/TurnIntoButton`.

- [ ] **Step 5: Style the toolbar like Notion**

Append to `editor.css`:

```css
/* ---------- Selection toolbar ---------- */
.bn-root .bn-formatting-toolbar {
  gap: 1px;
  padding: 3px;
  border: none;
  border-radius: 8px;
  background: var(--menu-bg);
  box-shadow: var(--menu-shadow);
}
.bn-root .bn-formatting-toolbar .bn-button {
  height: 28px;
  min-width: 28px;
  border-radius: 6px;
  color: var(--text);
}
.bn-root .nb-turn-into-button {
  gap: 4px;
  padding: 0 6px;
  font-size: 14px;
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test:e2e e2e/toolbar.spec.ts e2e/app.spec.ts`
Expected: PASS.
If Mantine's tooltip has no `role="tooltip"`, find its element class in the DOM and assert on that instead.

- [ ] **Step 7: Run everything and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`

```bash
git add src/renderer/src/editor e2e/toolbar.spec.ts
git commit -m "Give the selection toolbar Notion's buttons and a Turn into dropdown"
```

### Task 7: Ship PR 1

- [ ] **Step 1: Review the look side by side with Notion**

Run: `pnpm test:e2e e2e/screenshots.spec.ts`, open both reference screenshots, and also run the audit capture used for this spec (open the slash menu, the block menu and the toolbar on a page with lists) in light and dark mode.
Compare each with Notion on a public page in the in-app browser (for example the Notion Block Reference page) and fix any visible differences in spacing, colours or alignment before going on.

- [ ] **Step 2: Run the full suite twice**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm test:e2e`
Expected: everything passes both times; fix any flaky test before going on.

- [ ] **Step 3: Push and open the PR (after the user approves)**

Ask the user before pushing or opening the PR.

```bash
git push -u origin notion-polish
gh pr create --repo Dale1201/nobsidian --base main --title "Notion-style lists, menus and toolbar" --body "<summary of Tasks 1-6 and how they were tested>"
```

---

# PR 2: Sidebar

Start after PR 1 is merged: `git switch main && git pull --ff-only && git switch -c notion-sidebar`.

### Task 8: Show the current page in the sidebar

**Files:**
- Create: `e2e/sidebar.spec.ts`
- Modify: `src/renderer/src/store.ts`, `src/renderer/src/components/SidebarRow.tsx`

**Interfaces:**
- Consumes: `pathTo(nodes, id)` from `src/renderer/src/lib/tree.ts`.
- Produces: store action `revealInSidebar(id: string): Promise<void>`.

- [ ] **Step 1: Write the failing end-to-end test**

```ts
// e2e/sidebar.spec.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type AppFixture } from './fixtures'

async function nestedWorkspace(nb: AppFixture): Promise<Page> {
  await mkdir(join(nb.workspace, 'Top', 'Middle'), { recursive: true })
  await writeFile(join(nb.workspace, 'Top.md'), 'top\n')
  await writeFile(join(nb.workspace, 'Top', 'Middle.md'), 'middle\n')
  await writeFile(join(nb.workspace, 'Top', 'Middle', 'Deep.md'), 'deep\n')
  await writeFile(join(nb.workspace, 'Linker.md'), '[Deep](Top/Middle/Deep.md "page")\n')
  return nb.relaunch()
}

async function search(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Meta+k')
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test('opening a nested page from search reveals and highlights it', async ({ nb }) => {
  const page = await nestedWorkspace(nb)
  await expect(page.getByTestId('sidebar-row-Deep')).toBeHidden()
  await search(page, 'Deep')
  await expect(page.getByTestId('sidebar-row-Middle')).toBeVisible()
  await expect(page.getByTestId('sidebar-row-Deep')).toHaveClass(/active/)
})

test('following a link reveals the page', async ({ nb }) => {
  const page = await nestedWorkspace(nb)
  await page.getByTestId('sidebar-row-Linker').click()
  await page.locator('.nb-page-link').click()
  await expect(page.getByTestId('sidebar-row-Deep')).toHaveClass(/active/)
})

test('Back reveals the previous page again after its parent was collapsed', async ({ nb }) => {
  const page = await nestedWorkspace(nb)
  await search(page, 'Deep')
  await page.getByTestId('sidebar-row-Linker').click()
  const top = page.getByTestId('sidebar-row-Top')
  await top.hover()
  await top.getByRole('button', { name: 'Collapse' }).click()
  await expect(page.getByTestId('sidebar-row-Deep')).toBeHidden()
  await page.keyboard.press('Meta+[')
  await expect(page.getByTestId('sidebar-row-Deep')).toHaveClass(/active/)
})

test('the current row scrolls into view', async ({ nb }) => {
  for (let i = 0; i < 40; i++) {
    await writeFile(join(nb.workspace, `Page ${String(i).padStart(2, '0')}.md`), 'x\n')
  }
  await mkdir(join(nb.workspace, 'Zzz'))
  await writeFile(join(nb.workspace, 'Zzz.md'), 'z\n')
  await writeFile(join(nb.workspace, 'Zzz', 'Target.md'), 'target\n')
  const page = await nb.relaunch()
  await search(page, 'Target')
  await expect(page.getByTestId('sidebar-row-Target')).toBeInViewport()
})
```

Check how the app's Back shortcut is triggered in existing tests (search `Meta+[` or `back` in `e2e/`); if menu accelerators do not fire in hidden mode, trigger Back through the same path the existing tests use.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:e2e e2e/sidebar.spec.ts`
Expected: FAIL; `Deep` stays hidden after opening it.

- [ ] **Step 3: Add `revealInSidebar` and call it on every navigation**

In `src/renderer/src/store.ts`, import `pathTo` from `./lib/tree`, add `revealInSidebar: (id: string) => Promise<void>` to the state interface, and implement:

```ts
  revealInSidebar: async (id) => {
    const { settings, workspace, tree } = get()
    if (!settings || !workspace) return
    const current = settings.expanded[workspace.root] ?? []
    const missing = pathTo(tree, id)
      .slice(0, -1)
      .map((n) => n.id)
      .filter((a) => !current.includes(a))
    if (missing.length === 0) return
    await get().updateSettings({
      expanded: { ...settings.expanded, [workspace.root]: [...current, ...missing] }
    })
  },
```

Call it from `openPage` right after `set({ currentId: id, ... })`:

```ts
    void get().revealInSidebar(id)
```

And from `back` and `forward`, replacing each `return set({ currentId: history[i], historyIndex: i, trashEntry: null })` with:

```ts
      if (findNode(tree, history[i])) {
        set({ currentId: history[i], historyIndex: i, trashEntry: null })
        void get().revealInSidebar(history[i])
        return
      }
```

Check that the main process's `settings:set` merges patches key by key, so this patch and `openPage`'s `recent` patch cannot overwrite each other (see `src/main/settings.ts`).

- [ ] **Step 4: Scroll the current row into view**

In `SidebarRow.tsx`, add a ref on the row `div` and:

```tsx
  const rowRef = useRef<HTMLDivElement>(null)
  const isCurrent = currentId === node.id
  useEffect(() => {
    if (isCurrent) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isCurrent])
```

Use `isCurrent` in the class list in place of `currentId === node.id`.

- [ ] **Step 5: Run the tests**

Run: `pnpm test:e2e e2e/sidebar.spec.ts e2e/pages.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/renderer/src/store.ts src/renderer/src/components/SidebarRow.tsx e2e/sidebar.spec.ts
git commit -m "Expand the sidebar to the page you open and keep it in view"
```

### Task 9: Expandable favorites

**Files:**
- Modify: `src/renderer/src/components/SidebarRow.tsx`, `src/renderer/src/components/Sidebar.tsx`, `e2e/sidebar.spec.ts`

**Interfaces:**
- Produces: `SidebarRow` prop `scope?: 'pages' | 'favorites'` (default `'pages'`); favorites expansion is stored under the key `fav:<id>`.

- [ ] **Step 1: Write the failing test**

Append to `e2e/sidebar.spec.ts`:

```ts
test('favorites expand on their own', async ({ nb }) => {
  await mkdir(join(nb.workspace, 'Starred'))
  await writeFile(join(nb.workspace, 'Starred.md'), 's\n')
  await writeFile(join(nb.workspace, 'Starred', 'Child.md'), 'c\n')
  const page = await nb.relaunch()
  const pagesRow = page.getByTestId('sidebar-row-Starred')
  await pagesRow.hover()
  await pagesRow.getByRole('button', { name: 'Page actions' }).click()
  await page.getByRole('menuitem', { name: 'Add to Favorites' }).click()
  const favorites = page.locator('.sidebar-section', { hasText: 'Favorites' })
  const favRow = favorites.getByTestId('sidebar-row-Starred')
  await favRow.hover()
  await favRow.getByRole('button', { name: 'Expand' }).click()
  await expect(favorites.getByTestId('sidebar-row-Child')).toBeVisible()
  const pages = page.locator('.sidebar-section', { hasText: 'Pages' })
  await expect(pages.getByTestId('sidebar-row-Child')).toBeHidden()
})

test('a page without sub-pages says so when expanded', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Leaf.md'), 'l\n')
  const page = await nb.relaunch()
  const row = page.getByTestId('sidebar-row-Leaf')
  await row.hover()
  await row.getByRole('button', { name: 'Expand' }).click()
  await expect(page.locator('.sidebar-empty')).toHaveText('No pages inside')
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:e2e e2e/sidebar.spec.ts -g favorites`
Expected: FAIL, favorite rows have no Expand button.

- [ ] **Step 3: Implement scoped expansion**

In `SidebarRow.tsx`, add the prop and use a scoped key everywhere expansion is read or written:

```tsx
  scope = 'pages'
}: {
  node: PageNode
  depth: number
  draggable?: boolean
  expandable?: boolean
  scope?: 'pages' | 'favorites'
}): React.JSX.Element {
```

```tsx
  const expandKey = scope === 'favorites' ? `fav:${node.id}` : node.id
  const expanded = expandable && expandedIds.includes(expandKey)
```

Replace `app().setExpanded(node.id, !expanded)` with `app().setExpanded(expandKey, !expanded)`, and render children with the same scope and draggability:

```tsx
          node.children.map((child) => (
            <SidebarRow
              key={child.id}
              node={child}
              depth={depth + 1}
              scope={scope}
              draggable={draggable}
            />
          ))
```

In `Sidebar.tsx`, render favorites as `<SidebarRow key={node.id} node={node} depth={0} draggable={false} scope="favorites" />` (drop `expandable={false}`).

- [ ] **Step 4: Run the tests and commit**

Run: `pnpm test:e2e e2e/sidebar.spec.ts e2e/pages.spec.ts && pnpm typecheck && pnpm lint`

```bash
git add src/renderer/src/components e2e/sidebar.spec.ts
git commit -m "Let favorites expand to show their sub-pages"
```

### Task 10: Dragging pages like Notion

**Files:**
- Modify: `src/renderer/src/components/SidebarRow.tsx`, `src/renderer/src/components/Sidebar.tsx`, `e2e/sidebar.spec.ts`

**Interfaces:**
- Consumes: `expandKey` from Task 9.

- [ ] **Step 1: Write the failing test**

Append to `e2e/sidebar.spec.ts` (add `access` to the `node:fs/promises` import):

```ts
test('holding a dragged page over a collapsed page opens it, and dropping nests it', async ({
  nb
}) => {
  await mkdir(join(nb.workspace, 'Folder'))
  await writeFile(join(nb.workspace, 'Folder.md'), 'f\n')
  await writeFile(join(nb.workspace, 'Folder', 'Inside.md'), 'i\n')
  await writeFile(join(nb.workspace, 'Mover.md'), 'm\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Mover').hover()
  await page.mouse.down()
  const box = (await page.getByTestId('sidebar-row-Folder').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y, { steps: 5 })
  await page.waitForTimeout(700)
  await page.mouse.move(x + 2, y, { steps: 2 })
  await expect(page.getByTestId('sidebar-row-Inside')).toBeVisible()
  await page.mouse.up()
  await expect
    .poll(() =>
      access(join(nb.workspace, 'Folder', 'Mover.md')).then(
        () => true,
        () => false
      )
    )
    .toBe(true)
})
```

If Playwright's mouse does not start an HTML5 drag in Electron, dispatch `dragstart`, `dragover` and `drop` events with one shared `DataTransfer` from `page.evaluate` instead, keeping the 700ms wait between two `dragover` events.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:e2e e2e/sidebar.spec.ts -g "dragged page"`
Expected: FAIL; `Inside` stays hidden.

- [ ] **Step 3: Expand on hover while dragging**

In `SidebarRow.tsx`:

```tsx
  const expandTimer = useRef<number | null>(null)
  const stopExpandTimer = (): void => {
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current)
    expandTimer.current = null
  }
  useEffect(() => stopExpandTimer, [])
```

In `onDragOver`, after computing the position:

```tsx
          const position = positionFor(e)
          setDrop(position)
          if (position === 'inside' && expandable && !expanded && node.children.length) {
            expandTimer.current ??= window.setTimeout(() => {
              expandTimer.current = null
              void app().setExpanded(expandKey, true)
            }, 500)
          } else {
            stopExpandTimer()
          }
```

Call `stopExpandTimer()` in `onDragLeave` and at the start of `onDrop`.

- [ ] **Step 4: Scroll the list near its edges while dragging**

In `Sidebar.tsx`, on the `.sidebar-scroll` element:

```tsx
      <div
        className="sidebar-scroll"
        onDragOver={(e) => {
          const el = e.currentTarget
          const { top, bottom } = el.getBoundingClientRect()
          if (e.clientY < top + 32) el.scrollTop -= 8
          else if (e.clientY > bottom - 32) el.scrollTop += 8
        }}
      >
```

- [ ] **Step 5: Run the tests and commit**

Run: `pnpm test:e2e e2e/sidebar.spec.ts && pnpm typecheck && pnpm lint`

```bash
git add src/renderer/src/components e2e/sidebar.spec.ts
git commit -m "Open collapsed pages and scroll the sidebar while dragging"
```

### Task 11: Ship PR 2

- [ ] **Step 1: Run the full suite twice**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm test:e2e`
Expected: everything passes both times.

- [ ] **Step 2: Push and open the PR (after the user approves)**

```bash
git push -u origin notion-sidebar
gh pr create --repo Dale1201/nobsidian --base main --title "Sidebar shows where you are" --body "<summary of Tasks 8-10 and how they were tested>"
```

---

# PR 3: Typing

Start after PR 2 is merged: `git switch main && git pull --ff-only && git switch -c notion-typing`.

### Task 12: Markdown shortcuts like Notion

**Files:**
- Create: `src/renderer/src/editor/markdownShortcuts.ts`, `e2e/shortcuts.spec.ts`
- Modify: `package.json`, `src/renderer/src/editor/schema.tsx`, `src/renderer/src/editor/Editor.tsx`

**Interfaces:**
- Produces: `quoteShortcut`, `headingShortcuts`, `markdownShortcuts` (BlockNote extensions), `singleTildeStrike` (tiptap extension).

- [ ] **Step 1: Write the failing end-to-end test**

```ts
// e2e/shortcuts.spec.ts
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { editor, newPage, openFile, waitForFile } from './helpers'

const lastType = (page: Page): Promise<string | null> =>
  page.locator(`${editor} .bn-block-content`).last().getAttribute('data-content-type')

const typed: [string, string, string][] = [
  ['- item', 'bulletListItem', '- item'],
  ['* item', 'bulletListItem', '- item'],
  ['+ item', 'bulletListItem', '- item'],
  ['1. item', 'numberedListItem', '1. item'],
  ['[] item', 'checkListItem', '- [ ] item'],
  ['> item', 'toggleListItem', '<summary>item</summary>'],
  ['" item', 'quote', '> item'],
  ['# item', 'heading', '# item'],
  ['## item', 'heading', '## item'],
  ['### item', 'heading', '### item']
]

for (const [keys, type, saved] of typed) {
  test(`typing "${keys}" makes a ${type}`, async ({ nb }) => {
    const { page } = nb
    await newPage(page, 'Typing')
    await page.keyboard.type(keys)
    expect(await lastType(page)).toBe(type)
    await waitForFile(join(nb.workspace, 'Typing.md'), saved)
  })
}

test('#### stays text, as Notion has three heading levels', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Four')
  await page.keyboard.type('#### item')
  expect(await lastType(page)).toBe('paragraph')
})

test('--- makes a divider and ``` makes a code block at once', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Blocks')
  await page.keyboard.type('---')
  await expect(page.locator(`${editor} [data-content-type="divider"]`)).toHaveCount(1)
  await page.locator(`${editor} .bn-block-content`).last().click()
  await page.keyboard.type('```')
  expect(await lastType(page)).toBe('codeBlock')
})

test('inline Markdown, including single-tilde strikethrough', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Inline')
  await page.keyboard.type('**bold** *it* `code` ~gone~ ')
  await waitForFile(join(nb.workspace, 'Inline.md'), '**bold** *it* `code` ~~gone~~')
})

test('files with > quotes still open as quotes', async ({ nb }) => {
  const page = await openFile(nb, 'Quoted', '> Quoted text\n')
  expect(await page.locator(`${editor} [data-content-type="quote"]`).count()).toBe(1)
})
```

Check the saved forms against `src/shared/core/serialize.ts` (toggle and strikethrough) and correct the expected strings to what the serializer writes.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:e2e e2e/shortcuts.spec.ts`
Expected: FAIL for `>`, `####`, ` ``` `, `~gone~`, and possibly `-` (the audit saw it once).
If `- item` fails, reproduce it by hand in the app first, find why (for example the paragraph not being empty, or another input rule winning), and fix the cause before going on.

- [ ] **Step 3: Add `@tiptap/core` pinned to BlockNote's version**

```bash
pnpm add -E @tiptap/core@3.32.0
ls node_modules/.pnpm | grep -E "^@tiptap\+core@"
```

Expected: one version listed.

- [ ] **Step 4: Implement the shortcuts**

```ts
// src/renderer/src/editor/markdownShortcuts.ts
import { createExtension } from '@blocknote/core'
import { codeBlockOptions } from '@blocknote/code-block'
import { Extension, markInputRule } from '@tiptap/core'

/** Notion's `"` quote, without BlockNote's `>` quote, which Notion uses for toggles. */
export const quoteShortcut = createExtension({
  key: 'nb-quote-shortcut',
  inputRules: [{ find: /^\p{Quotation_Mark}\s$/u, replace: () => ({ type: 'quote', props: {} }) }]
})

/** Headings 1-3 only, as in Notion; deeper headings from files still open. */
export const headingShortcuts = createExtension({
  key: 'nb-heading-shortcuts',
  inputRules: [1, 2, 3].map((level) => ({
    find: new RegExp(`^#{${level}}\\s$`),
    replace: () => ({ type: 'heading', props: { level, isToggleable: false } })
  })),
  keyboardShortcuts: Object.fromEntries(
    [1, 2, 3].map((level) => [
      `Mod-Alt-${level}`,
      ({ editor }) => {
        const { block } = editor.getTextCursorPosition()
        if (editor.schema.blockSchema[block.type].content !== 'inline') return false
        editor.updateBlock(block, { type: 'heading', props: { level, isToggleable: false } })
        return true
      }
    ])
  )
})

export const markdownShortcuts = createExtension({
  key: 'nb-markdown-shortcuts',
  inputRules: [
    { find: /^>\s$/, replace: () => ({ type: 'toggleListItem', props: {} }) },
    {
      find: /^```$/,
      replace: () => ({
        type: 'codeBlock',
        props: { language: codeBlockOptions.defaultLanguage ?? 'text' }
      })
    }
  ]
})

/** Notion strikes through `~text~`; tiptap only knows `~~text~~`. */
export const singleTildeStrike = Extension.create({
  name: 'nbSingleTildeStrike',
  addInputRules() {
    const strike = this.editor.schema.marks.strike
    return strike ? [markInputRule({ find: /(?:^|\s)(~(?!~)([^~]+)~)$/, type: strike })] : []
  }
})
```

Pass `singleTildeStrike` through a BlockNote extension: `createExtension({ key: 'nb-tilde-strike', tiptapExtensions: [singleTildeStrike] })`, exported as `tildeStrike`.

- [ ] **Step 5: Use them**

In `schema.tsx`, import `quoteShortcut` and `headingShortcuts` and override the two specs:

```ts
    blockSpecs: {
      ...defaultBlockSpecs,
      quote: { ...defaultBlockSpecs.quote, extensions: [quoteShortcut] },
      heading: { ...defaultBlockSpecs.heading, extensions: [headingShortcuts] },
      codeBlock: createCodeBlockSpec(codeBlockOptions),
```

In `Editor.tsx`, add `markdownShortcuts` and `tildeStrike` to `extensions`.

- [ ] **Step 6: Run the tests**

Run: `pnpm test:e2e e2e/shortcuts.spec.ts e2e/app.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add package.json pnpm-lock.yaml src/renderer/src/editor e2e/shortcuts.spec.ts
git commit -m "Match Notion's Markdown shortcuts: > for toggles, ``` at once, ~strike~"
```

### Task 13: Notion keyboard commands

**Files:**
- Create: `src/renderer/src/editor/notionKeys.ts`
- Modify: `src/renderer/src/editor/markdownShortcuts.ts`, `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/editor/menus/BlockMenu.tsx`, `e2e/shortcuts.spec.ts`

**Interfaces:**
- Consumes: `turnIntoBlocks`, `duplicateBlocks` (Task 5), `selectedBlockIds`, `selectBlocks` (Task 5), `TurnIntoId` (Task 3), `BlockMenuApi` (Task 5).
- Produces: `targetBlockIds(editor: AppEditor): string[]`, `notionKeys` (BlockNote extension).

- [ ] **Step 1: Write the failing tests**

Append to `e2e/shortcuts.spec.ts`:

```ts
test('Cmd+D duplicates the block', async ({ nb }) => {
  const page = await openFile(nb, 'Dup', 'Copy me\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'Copy me' }).click()
  await page.keyboard.press('Meta+d')
  await expect(page.locator(`${editor} .bn-block-content`, { hasText: 'Copy me' })).toHaveCount(2)
})

const turnKeys: [string, string][] = [
  ['4', 'checkListItem'],
  ['5', 'bulletListItem'],
  ['6', 'numberedListItem'],
  ['7', 'toggleListItem'],
  ['8', 'codeBlock'],
  ['1', 'heading'],
  ['0', 'paragraph']
]

test('Cmd+Option+number turns the block into Notion types', async ({ nb }) => {
  const page = await openFile(nb, 'Turns', 'Shape shifter\n')
  for (const [key, type] of turnKeys) {
    await page.locator(`${editor} .bn-block-content`).first().click()
    await page.keyboard.press(`Meta+Alt+${key}`)
    await expect(page.locator(`${editor} .bn-block-content`).first()).toHaveAttribute(
      'data-content-type',
      type
    )
  }
})

test('Cmd+Enter ticks a to-do and opens a toggle', async ({ nb }) => {
  const page = await openFile(
    nb,
    'Enter',
    '- [ ] task\n\n<details>\n<summary>fold</summary>\n\ninside\n\n</details>\n'
  )
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'task' }).click()
  await page.keyboard.press('Meta+Enter')
  await waitForFile(join(nb.workspace, 'Enter.md'), '- [x] task')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'fold' }).click()
  await page.keyboard.press('Meta+Enter')
  await expect(page.locator(`${editor} .bn-toggle-button`)).toHaveAttribute('aria-expanded', 'true')
})

test('Cmd+/ opens the block menu with search focused', async ({ nb }) => {
  const page = await openFile(nb, 'Slash', 'Change me\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'Change me' }).click()
  await page.keyboard.press('Meta+/')
  await expect(page.getByPlaceholder('Search actions…')).toBeFocused()
  await page.keyboard.type('heading 2')
  await page.keyboard.press('Enter')
  await waitForFile(join(nb.workspace, 'Slash.md'), '## Change me')
})

test('Cmd+Shift+Up moves the block, and Cmd+K opens search', async ({ nb }) => {
  const page = await openFile(nb, 'Move', 'One\n\nTwo\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'Two' }).click()
  await page.keyboard.press('Meta+Shift+ArrowUp')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText([/Two/, /One/])
  await page.keyboard.press('Meta+k')
  await expect(page.getByTestId('search-modal')).toBeVisible()
})
```

Use the search modal's real test id (see `SearchModal.tsx`).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:e2e e2e/shortcuts.spec.ts`
Expected: FAIL for Cmd+D, Cmd+Option+4 to 8, Cmd+Enter and Cmd+/.

- [ ] **Step 3: Implement the keyboard commands**

```ts
// src/renderer/src/editor/notionKeys.ts
import { createExtension } from '@blocknote/core'
import { duplicateBlocks, turnIntoBlocks } from './blockActions'
import { selectBlocks, selectedBlockIds } from './blockSelection'
import type { AppEditor } from './schema'
import type { TurnIntoId } from './turnInto'

/** The selected blocks, or the blocks the text selection touches. */
export function targetBlockIds(editor: AppEditor): string[] {
  const selected = selectedBlockIds(editor)
  if (selected.length) return selected
  const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
  return blocks.map((b) => b.id)
}

const TURN_KEYS: Record<string, TurnIntoId> = {
  'Mod-Alt-0': 'paragraph',
  'Mod-Alt-1': 'heading1',
  'Mod-Alt-2': 'heading2',
  'Mod-Alt-3': 'heading3',
  'Mod-Alt-4': 'todo',
  'Mod-Alt-5': 'bullet',
  'Mod-Alt-6': 'numbered',
  'Mod-Alt-7': 'toggle',
  'Mod-Alt-8': 'code'
}

function toggleBlock(editor: AppEditor): boolean {
  const { block } = editor.getTextCursorPosition()
  if (block.type === 'checkListItem') {
    editor.updateBlock(block, { props: { checked: !block.props.checked } })
    return true
  }
  const button = editor.domElement?.querySelector<HTMLElement>(
    `.bn-block-outer[data-id="${block.id}"] .bn-toggle-button`
  )
  button?.click()
  return button !== null && button !== undefined
}

export const notionKeys = createExtension({
  key: 'nb-notion-keys',
  keyboardShortcuts: {
    ...Object.fromEntries(
      Object.entries(TURN_KEYS).map(([keys, id]) => [
        keys,
        ({ editor }: { editor: AppEditor }) => {
          turnIntoBlocks(editor, targetBlockIds(editor), id)
          return true
        }
      ])
    ),
    'Mod-d': ({ editor }) => {
      const app = editor as AppEditor
      const wasSelected = selectedBlockIds(app).length > 0
      const copies = duplicateBlocks(app, targetBlockIds(app))
      if (wasSelected) selectBlocks(app, copies)
      return true
    },
    'Mod-Enter': ({ editor }) => toggleBlock(editor as AppEditor)
  }
})
```

Remove `keyboardShortcuts` from `headingShortcuts` in `markdownShortcuts.ts` (Mod-Alt-1 to 3 now live here), and add `notionKeys` to `extensions` in `Editor.tsx`.

- [ ] **Step 4: Open the block menu with Cmd+/**

In `BlockMenuHost` (`menus/BlockMenu.tsx`), import `useEditorDOMElement` from `@blocknote/react`, `useEffect` from `react` and `targetBlockIds` from `../notionKeys`, then add:

```tsx
  const dom = useEditorDOMElement()
  useEffect(() => {
    // Capture phase, before ProseMirror sees the key.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || !e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
      const ids = targetBlockIds(editor)
      const el = dom?.querySelector(`.bn-block-outer[data-id="${ids[0]}"] .bn-block-content`)
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      const r = el.getBoundingClientRect()
      api.open(ids, new DOMRect(r.left, r.top, 0, Math.min(r.height, 30)))
    }
    dom?.addEventListener('keydown', onKey, true)
    return () => dom?.removeEventListener('keydown', onKey, true)
  }, [dom, editor, api])
```

- [ ] **Step 5: Run the tests and commit**

Run: `pnpm test:e2e e2e/shortcuts.spec.ts e2e/blockmenu.spec.ts && pnpm typecheck && pnpm lint`

```bash
git add src/renderer/src/editor e2e/shortcuts.spec.ts
git commit -m "Add Notion's Cmd+D, Cmd+Option+number, Cmd+Enter and Cmd+/ commands"
```

### Task 14: Selecting blocks with Esc

**Files:**
- Create: `src/renderer/src/editor/blockSelectionModel.ts`, `src/renderer/src/editor/blockSelectionModel.test.ts`, `src/renderer/src/editor/BlockSelectionKeys.tsx`
- Modify: `src/renderer/src/editor/blockActions.ts`, `src/renderer/src/editor/Editor.tsx`, `e2e/shortcuts.spec.ts`

**Interfaces:**
- Consumes: `selectBlocks`, `selectedBlockIds`, `deleteBlocks`, `blocksOf` (Task 5), `targetBlockIds` (Task 13).
- Produces: `stepSelection(doc: OutlineNode[], ids: string[], delta: 1 | -1, extend: boolean): string[]` with `interface OutlineNode { id: string; children: OutlineNode[] }`, `moveBlocks(editor, ids, direction: 'up' | 'down'): void`, `BlockSelectionKeys`.

- [ ] **Step 1: Write the failing unit test**

```ts
// src/renderer/src/editor/blockSelectionModel.test.ts
import { describe, expect, it } from 'vitest'
import { stepSelection, type OutlineNode } from './blockSelectionModel'

const node = (id: string, children: OutlineNode[] = []): OutlineNode => ({ id, children })
const doc = [node('a', [node('a1'), node('a2')]), node('b'), node('c')]

describe('stepSelection', () => {
  it('moves through blocks in reading order, children included', () => {
    expect(stepSelection(doc, ['a'], 1, false)).toEqual(['a1'])
    expect(stepSelection(doc, ['a2'], 1, false)).toEqual(['b'])
    expect(stepSelection(doc, ['b'], -1, false)).toEqual(['a2'])
  })

  it('stops at the ends', () => {
    expect(stepSelection(doc, ['a'], -1, false)).toEqual(['a'])
    expect(stepSelection(doc, ['c'], 1, false)).toEqual(['c'])
  })

  it('extends with Shift', () => {
    expect(stepSelection(doc, ['b'], 1, true)).toEqual(['b', 'c'])
    expect(stepSelection(doc, ['b'], -1, true)).toEqual(['a2', 'b'])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/renderer/src/editor/blockSelectionModel.test.ts`
Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Implement the model**

```ts
// src/renderer/src/editor/blockSelectionModel.ts
export interface OutlineNode {
  id: string
  children: OutlineNode[]
}

function readingOrder(nodes: OutlineNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.id)
    readingOrder(n.children, out)
  }
  return out
}

export function stepSelection(
  doc: OutlineNode[],
  ids: string[],
  delta: 1 | -1,
  extend: boolean
): string[] {
  const order = readingOrder(doc)
  const edge = order.indexOf(delta === 1 ? ids[ids.length - 1] : ids[0])
  const next = order[Math.min(order.length - 1, Math.max(0, edge + delta))]
  if (!extend) return [next]
  const merged = delta === 1 ? [...ids, next] : [next, ...ids]
  return merged.filter((id, i) => merged.indexOf(id) === i)
}
```

- [ ] **Step 4: Run the unit test**

Run: `pnpm vitest run src/renderer/src/editor/blockSelectionModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing end-to-end test**

Append to `e2e/shortcuts.spec.ts`:

```ts
test('Esc selects the block; arrows, Shift and Backspace act on the selection', async ({ nb }) => {
  const page = await openFile(nb, 'Select', 'One\n\nTwo\n\nThree\n')
  const selected = page.locator(`${editor} .nb-block-selected`)
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'One' }).click()
  await page.keyboard.press('Escape')
  await expect(selected).toHaveText(['One'])
  await page.keyboard.press('ArrowDown')
  await expect(selected).toHaveText(['Two'])
  await page.keyboard.press('Shift+ArrowDown')
  await expect(selected).toHaveText(['Two', 'Three'])
  await page.keyboard.type('xyz')
  await expect(page.locator(editor)).not.toContainText('xyz')
  await page.keyboard.press('Backspace')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText([/One/])
})

test('Cmd+Shift+Down moves selected blocks and keeps them selected', async ({ nb }) => {
  const page = await openFile(nb, 'MoveSel', 'One\n\nTwo\n\nThree\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'One' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+Shift+ArrowDown')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText([/Two/, /One/, /Three/])
  await expect(page.locator(`${editor} .nb-block-selected`)).toHaveText(['One'])
})

test('a click or Enter returns to typing; copy takes the selected blocks', async ({ nb }) => {
  const page = await openFile(nb, 'Back', 'Alpha\n\nBeta\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'Alpha' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+c')
  const copied = await nb.app.evaluate(({ clipboard }) => clipboard.readText())
  expect(copied).toContain('Alpha')
  await page.keyboard.press('Enter')
  await expect(page.locator(`${editor} .nb-block-selected`)).toHaveCount(0)
  await page.keyboard.type('!')
  await expect(page.locator(`${editor} .bn-block-content`).first()).toHaveText('Alpha!')
  await page.keyboard.press('Escape')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'Beta' }).click()
  await expect(page.locator(`${editor} .nb-block-selected`)).toHaveCount(0)
})
```

- [ ] **Step 6: Run it to see it fail**

Run: `pnpm test:e2e e2e/shortcuts.spec.ts -g "Esc|selected|click or Enter"`
Expected: FAIL, Esc does not select.

- [ ] **Step 7: Add `moveBlocks`**

Append to `blockActions.ts`:

```ts
/** Moves contiguous sibling blocks past their neighbour, or out of their parent at an edge. */
export function moveBlocks(editor: AppEditor, ids: string[], direction: 'up' | 'down'): void {
  const blocks = blocksOf(editor, ids)
  if (blocks.length === 0) return
  const edge = direction === 'up' ? blocks[0] : blocks[blocks.length - 1]
  const target =
    (direction === 'up' ? editor.getPrevBlock(edge) : editor.getNextBlock(edge)) ??
    editor.getParentBlock(edge)
  if (!target) return
  editor.transact(() => {
    editor.removeBlocks(blocks)
    // Same ids, so a block selection still points at the moved blocks.
    editor.insertBlocks(blocks as unknown as AppPartialBlock[], target, direction === 'up' ? 'before' : 'after')
  })
}
```

- [ ] **Step 8: Implement the selection keys**

```tsx
// src/renderer/src/editor/BlockSelectionKeys.tsx
import { SuggestionMenu } from '@blocknote/core/extensions'
import { useEditorDOMElement, useExtension } from '@blocknote/react'
import { useEffect } from 'react'
import { blocksOf, deleteBlocks, moveBlocks } from './blockActions'
import { selectBlocks, selectedBlockIds } from './blockSelection'
import { stepSelection } from './blockSelectionModel'
import { targetBlockIds } from './notionKeys'
import type { AppEditor } from './schema'
import { useAppEditor } from './useAppEditor'

function onSelectionKey(editor: AppEditor, ids: string[], e: KeyboardEvent): boolean {
  const mod = e.metaKey || e.ctrlKey
  const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
  if (e.key === 'Escape') {
    selectBlocks(editor, [])
    return true
  }
  if (e.key === 'Enter' && !mod) {
    selectBlocks(editor, [])
    try {
      editor.setTextCursorPosition(ids[ids.length - 1], 'end')
    } catch {
      // A block without text has nowhere to put the cursor; it stays unselected.
    }
    return true
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    deleteBlocks(editor, ids)
    return true
  }
  if (vertical && mod && e.shiftKey) {
    moveBlocks(editor, ids, e.key === 'ArrowUp' ? 'up' : 'down')
    selectBlocks(editor, ids)
    return true
  }
  if (vertical && !mod) {
    selectBlocks(editor, stepSelection(editor.document, ids, e.key === 'ArrowUp' ? -1 : 1, e.shiftKey))
    return true
  }
  // Shortcuts like Cmd+D, Cmd+/ and Cmd+C have their own handlers; typing is ignored, as in Notion.
  return !mod && e.key.length === 1
}

export function BlockSelectionKeys(): null {
  const editor = useAppEditor()
  const dom = useEditorDOMElement()
  const suggestionMenu = useExtension(SuggestionMenu)

  useEffect(() => {
    if (!dom) return
    const onKey = (e: KeyboardEvent): void => {
      const ids = selectedBlockIds(editor)
      const plainEscape = e.key === 'Escape' && !e.metaKey && !e.altKey && !e.shiftKey
      const handled = ids.length
        ? onSelectionKey(editor, ids, e)
        : plainEscape && !suggestionMenu.shown() && (selectBlocks(editor, targetBlockIds(editor)), true)
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onClipboard = (e: ClipboardEvent): void => {
      const ids = selectedBlockIds(editor)
      if (!ids.length || !e.clipboardData) return
      const blocks = blocksOf(editor, ids)
      e.clipboardData.setData('text/html', editor.blocksToHTMLLossy(blocks))
      e.clipboardData.setData('text/plain', editor.blocksToMarkdownLossy(blocks))
      e.preventDefault()
      if (e.type === 'cut') deleteBlocks(editor, ids)
    }
    // Capture phase, so these run before ProseMirror's own handlers.
    dom.addEventListener('keydown', onKey, true)
    dom.addEventListener('copy', onClipboard, true)
    dom.addEventListener('cut', onClipboard, true)
    return () => {
      dom.removeEventListener('keydown', onKey, true)
      dom.removeEventListener('copy', onClipboard, true)
      dom.removeEventListener('cut', onClipboard, true)
    }
  }, [dom, editor, suggestionMenu])
  return null
}
```

If lint rejects the comma expression in `handled`, compute it with an `if` block instead.
Render `<BlockSelectionKeys />` inside `BlockMenuHost` in `Editor.tsx`, next to `HighlightShortcut`.
Esc while the block menu or slash menu is open must still close that menu first: the menu kit handles Escape in the document capture phase, which runs before this editor listener.

- [ ] **Step 9: Run the tests**

Run: `pnpm test:e2e e2e/shortcuts.spec.ts e2e/blockmenu.spec.ts e2e/slash.spec.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/renderer/src/editor e2e/shortcuts.spec.ts
git commit -m "Select blocks with Esc and act on them with the keyboard"
```

### Task 15: Page mentions in Markdown

**Files:**
- Create: `src/shared/core/mentions.test.ts`
- Modify: `src/shared/core/blocks.ts`, `src/shared/core/inline.ts`, `src/shared/core/normalize.ts`, `src/shared/core/text.ts`, `src/shared/core/links.ts`, `src/main/workspace/core.ts`, `src/main/workspace/workspace.ts`, `src/main/workspace/page-history.ts`, `src/main/workspace/workspace.test.ts`

**Interfaces:**
- Produces:
  - `interface PageMentionInline { type: 'pageMention'; props: { href: string; title: string } }`, added to `Inline`.
  - `mapBlockInline(blocks: Block[], map: (item: Inline) => Inline): Block[]` and `refreshMentionTitles(blocks: Block[], titleOf: (href: string) => string | undefined): Block[]` in `links.ts`.
  - `WorkspaceCore.toFileBlocks(pagePath: string, blocks: Block[]): Block[]`.

- [ ] **Step 1: Write the failing unit tests**

```ts
// src/shared/core/mentions.test.ts
import { describe, expect, it } from 'vitest'
import type { Block } from './blocks'
import { mapBlockLinks, refreshMentionTitles } from './links'
import { markdownToBlocks } from './parse'
import { blocksToMarkdown } from './serialize'
import { blocksText } from './text'

const mention = (href: string, title: string): Block => ({
  type: 'paragraph',
  props: {},
  content: [
    { type: 'text', text: 'See ', styles: {} },
    { type: 'pageMention', props: { href, title } }
  ],
  children: []
})

describe('page mentions', () => {
  it('read and write as a link titled "mention"', () => {
    const md = 'See [Plans](Notes/Plans.md "mention")\n'
    expect(markdownToBlocks(md)).toEqual([mention('Notes/Plans.md', 'Plans')])
    expect(blocksToMarkdown([mention('Notes/Plans.md', 'Plans')])).toBe(md)
  })

  it('leave other links alone', () => {
    expect(markdownToBlocks('[Plans](Notes/Plans.md)\n')[0].content).toEqual([
      { type: 'link', href: 'Notes/Plans.md', content: [{ type: 'text', text: 'Plans', styles: {} }] }
    ])
  })

  it('count as text for search', () => {
    expect(blocksText([mention('x.md', 'Plans')])).toContain('Plans')
  })

  it('follow link rewriting', () => {
    const [moved] = mapBlockLinks([mention('Old.md', 'Plans')], () => 'New.md')
    expect(moved.content).toContainEqual({ type: 'pageMention', props: { href: 'New.md', title: 'Plans' } })
  })

  it('take the current title of their page', () => {
    const [fresh] = refreshMentionTitles([mention('nobsidian://page/1', 'Old')], (href) =>
      href === 'nobsidian://page/1' ? 'New' : undefined
    )
    expect(fresh.content).toContainEqual({
      type: 'pageMention',
      props: { href: 'nobsidian://page/1', title: 'New' }
    })
  })

  it('work inside table cells', () => {
    const table: Block = {
      type: 'table',
      props: {},
      content: { type: 'tableContent', rows: [{ cells: [[{ type: 'pageMention', props: { href: 'a.md', title: 'A' } }]] }] },
      children: []
    }
    const [moved] = mapBlockLinks([table], () => 'b.md')
    expect(JSON.stringify(moved)).toContain('"href":"b.md"')
  })
})
```

Append to `src/main/workspace/workspace.test.ts` (inside the describe block that holds the rename test):

```ts
  it('keeps mentions pointing at a renamed page, with its new title on save', async () => {
    const ws = await Workspace.open(root, { settleMs: 0 })
    const target = await ws.createPage(null)
    await ws.renamePage(target.id, 'Plans')
    const other = await ws.createPage(null)
    const blocks: Block[] = [
      {
        type: 'paragraph',
        props: {},
        content: [{ type: 'pageMention', props: { href: pageLinkHref(target.id), title: 'Plans' } }],
        children: []
      }
    ]
    await ws.writePage(other.id, blocks)
    expect(await read(other.path)).toContain('[Plans](Plans.md "mention")')
    await ws.renamePage(target.id, 'Roadmap')
    expect(await read(other.path)).toContain('(Roadmap.md "mention")')
    await ws.writePage(other.id, blocks)
    expect(await read(other.path)).toContain('[Roadmap](Roadmap.md "mention")')
  })
```

Check `writePage`'s real signature in `workspace.ts` (it may take options or return a result) and match the existing rename test's usage.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/shared/core/mentions.test.ts src/main/workspace/workspace.test.ts`
Expected: FAIL; TypeScript errors for `pageMention` and missing `refreshMentionTitles`.

- [ ] **Step 3: Add the inline type**

In `src/shared/core/blocks.ts`:

```ts
export interface PageMentionInline {
  type: 'pageMention'
  props: { href: string; title: string }
}

export type Inline = StyledText | LinkInline | InlineMath | PageMentionInline
```

Run `pnpm typecheck` and fix every place it reports a non-exhaustive branch over `Inline` with the changes below.

- [ ] **Step 4: Parse and serialize mentions**

In `src/shared/core/inline.ts`, at the top of the `case 'link':` branch of `walk`:

```ts
        case 'link': {
          if (node.title === 'mention') {
            const inner: Inline[] = []
            walk(node.children, {}, inner)
            const title = inner.map((i) => (i.type === 'text' ? i.text : '')).join('')
            target.push({ type: 'pageMention', props: { href: node.url, title } })
            break
          }
```

In `toSegments`, before the `link` branch:

```ts
    } else if (item.type === 'pageMention') {
      segments.push({
        kind: 'atom',
        node: {
          type: 'link',
          url: item.props.href,
          title: 'mention',
          children: [{ type: 'text', value: item.props.title || 'Untitled' }]
        }
      })
```

In `src/shared/core/normalize.ts` `normalizeInline`, before the final `else`:

```ts
    } else if (item.type === 'pageMention') {
      out.push({ type: 'pageMention', props: { href: item.props.href, title: item.props.title } })
```

In `src/shared/core/text.ts` `inlineText`:

```ts
      if (item.type === 'pageMention') return item.props.title
```

- [ ] **Step 5: Map hrefs and refresh titles**

In `src/shared/core/links.ts`, make `mapInline` handle mentions and add the two helpers:

```ts
function mapInline(content: Inline[], map: (href: string) => string): Inline[] {
  return content.map((item) => {
    if (item.type === 'link') return { ...item, href: mapNonEmpty(item.href, map) }
    if (item.type === 'pageMention') {
      return { ...item, props: { ...item.props, href: mapNonEmpty(item.props.href, map) } }
    }
    return item
  })
}

/** Returns copies of `blocks` with every inline item, table cells included, passed through `map`. */
export function mapBlockInline(blocks: Block[], map: (item: Inline) => Inline): Block[] {
  return blocks.map((block) => {
    const children = mapBlockInline(block.children, map)
    if (block.type === 'table') {
      return {
        ...block,
        content: {
          ...block.content,
          rows: block.content.rows.map((row) => ({
            cells: row.cells.map((cell) =>
              Array.isArray(cell) ? cell.map(map) : { ...cell, content: cell.content.map(map) }
            )
          }))
        },
        children
      }
    }
    if ('content' in block && Array.isArray(block.content) && block.type !== 'codeBlock') {
      return { ...block, content: (block.content as Inline[]).map(map), children } as Block
    }
    return { ...block, children } as Block
  })
}

export function refreshMentionTitles(
  blocks: Block[],
  titleOf: (href: string) => string | undefined
): Block[] {
  return mapBlockInline(blocks, (item) => {
    if (item.type !== 'pageMention') return item
    const title = titleOf(item.props.href)
    return title === undefined || title === item.props.title
      ? item
      : { ...item, props: { ...item.props, title } }
  })
}
```

- [ ] **Step 6: Write files through one path that refreshes titles**

In `src/main/workspace/core.ts`, import `refreshMentionTitles` and `Block`, and add next to `toFileHref`:

```ts
  /** Blocks as written to `pagePath`: page links become relative and mentions carry current titles. */
  toFileBlocks(pagePath: string, blocks: Block[]): Block[] {
    const titled = refreshMentionTitles(blocks, (href) => {
      const id = pageIdFromHref(href)
      return id ? this.pages.get(id)?.title : undefined
    })
    return mapBlockLinks(titled, (href) => this.toFileHref(pagePath, href))
  }
```

Replace each `mapBlockLinks(<blocks>, (href) => <core>.toFileHref(<path>, href))` in `workspace.ts` (three places) and `page-history.ts` (two places) with `<core>.toFileBlocks(<path>, <blocks>)`, and drop imports that become unused.

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run src/shared src/main`
Expected: PASS.

- [ ] **Step 8: Commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/shared src/main
git commit -m "Store page mentions as Markdown links that follow renames"
```

### Task 16: Mention chips and the @ and [[ page picker

**Files:**
- Create: `src/renderer/src/editor/pagePickerItems.ts`, `src/renderer/src/editor/pagePickerItems.test.ts`, `src/renderer/src/editor/menus/PagePicker.tsx`, `e2e/mentions.spec.ts`
- Modify: `src/renderer/src/editor/schema.tsx`, `src/renderer/src/editor/Editor.tsx`, `src/renderer/src/components/PageEditor.tsx`, `src/renderer/src/editor/editor.css`

**Interfaces:**
- Consumes: `PageLinkContext` (`resolve(href)`, `open(href)`) from `schema.tsx`; `pageLinkHref` from `@shared/core/links`; store `tree` and `settings.recent`.
- Produces:
  - `PageMention` inline content spec with `propSchema { href: { default: '' }, title: { default: '' } }`, registered as `pageMention`.
  - `rankPages(pages: PickerPage[], recent: string[], query: string, limit?: number): PickerPage[]` with `interface PickerPage { id: string; title: string; icon?: string; path: string }` (`path` is the muted parent path, such as `Notes / Rust`).
  - `EditorProps.createLinkedPage?(title: string): Promise<string>` returning the new page's internal href.
  - `PagePicker` suggestion menu component and `PickerItem` type.

- [ ] **Step 1: Write the failing unit test**

```ts
// src/renderer/src/editor/pagePickerItems.test.ts
import { describe, expect, it } from 'vitest'
import { rankPages, type PickerPage } from './pagePickerItems'

const pages: PickerPage[] = [
  { id: '1', title: 'Rust', path: 'Notes' },
  { id: '2', title: 'Ownership', path: 'Notes / Rust' },
  { id: '3', title: 'Trust fund', path: '' },
  { id: '4', title: 'Groceries', path: '' }
]

describe('rankPages', () => {
  it('shows recent pages first for an empty query', () => {
    expect(rankPages(pages, ['4', '2'], '').map((p) => p.id)).toEqual(['4', '2', '1', '3'])
  })

  it('ranks title starts before other matches, ignoring case', () => {
    expect(rankPages(pages, [], 'RU').map((p) => p.id)).toEqual(['1', '3'])
  })

  it('limits the list', () => {
    expect(rankPages(pages, [], '', 2)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run it to see it fail, then implement**

Run: `pnpm vitest run src/renderer/src/editor/pagePickerItems.test.ts`
Expected: FAIL, cannot resolve the module.

```ts
// src/renderer/src/editor/pagePickerItems.ts
export interface PickerPage {
  id: string
  title: string
  icon?: string
  /** Muted parent path, such as "Notes / Rust". */
  path: string
}

export function rankPages(
  pages: PickerPage[],
  recent: string[],
  query: string,
  limit = 8
): PickerPage[] {
  const q = query.trim().toLowerCase()
  const score = (p: PickerPage): number => {
    const title = (p.title || 'Untitled').toLowerCase()
    if (!q) {
      const r = recent.indexOf(p.id)
      return r === -1 ? recent.length : r
    }
    if (title.startsWith(q)) return 0
    if (title.includes(q)) return 1
    return -1
  }
  return pages
    .map((page, index) => ({ page, index, s: score(page) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.page)
}
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Write the failing end-to-end test**

```ts
// e2e/mentions.spec.ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, newPage, waitForFile } from './helpers'

test('@ links a page as a mention that opens it', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Roadmap.md'), '---\nicon: 🗺️\n---\n\nplan\n')
  const page = await nb.relaunch()
  await newPage(page, 'Notes')
  await page.keyboard.type('See @road')
  await expect(page.locator('.page-picker .menu-item-label').first()).toHaveText('Roadmap')
  await page.keyboard.press('Enter')
  const chip = page.locator(`${editor} .nb-mention`)
  await expect(chip).toHaveText('🗺️Roadmap')
  await waitForFile(join(nb.workspace, 'Notes.md'), 'See [Roadmap](Roadmap.md "mention")')
  await chip.click()
  await expect(page.getByTestId('page-title')).toHaveText('Roadmap')
})

test('[[ opens the same picker and can create a page', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Hub')
  await page.keyboard.type('[[Brand new')
  const create = page.locator('.page-picker .menu-item', { hasText: 'New page' })
  await expect(create).toContainText('Brand new')
  await create.click()
  await expect(page.locator(`${editor} .nb-mention`)).toHaveText(/Brand new/)
  await expect(page.getByTestId('sidebar-row-Brand new')).toBeVisible()
})

test('a mention shows the new title after a rename, and goes grey when the page is deleted', async ({
  nb
}) => {
  await writeFile(join(nb.workspace, 'Target.md'), 't\n')
  await writeFile(join(nb.workspace, 'Source.md'), 'Go to [Target](Target.md "mention")\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Source').click()
  const row = page.getByTestId('sidebar-row-Target')
  await row.hover()
  await row.getByRole('button', { name: 'Page actions' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('Renamed')
  await page.keyboard.press('Enter')
  await expect(page.locator(`${editor} .nb-mention`)).toHaveText(/Renamed/)
  const renamed = page.getByTestId('sidebar-row-Renamed')
  await renamed.hover()
  await renamed.getByRole('button', { name: 'Page actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.locator(`${editor} .nb-mention`)).toHaveAttribute('data-missing', 'true')
})
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm test:e2e e2e/mentions.spec.ts`
Expected: FAIL; `@` inserts plain text.

- [ ] **Step 5: Add the mention inline content**

In `schema.tsx`:

```tsx
export const PageMention = createReactInlineContentSpec(
  {
    type: 'pageMention',
    propSchema: { href: { default: '' }, title: { default: '' } },
    content: 'none'
  },
  {
    render: function PageMentionChip({ inlineContent }) {
      const ctx = useContext(PageLinkContext)
      const { href, title } = inlineContent.props
      const target = ctx?.resolve(href)
      return (
        <span
          className="nb-mention"
          data-missing={target ? undefined : 'true'}
          onClick={() => target && ctx?.open(href)}
        >
          <span className="nb-mention-icon">{target?.icon ?? '📄'}</span>
          <span className="nb-mention-title">{target?.title ?? (title || 'Untitled')}</span>
        </span>
      )
    }
  }
)
```

Register it: `inlineContentSpecs: { ...defaultInlineContentSpecs, inlineMath: InlineMath, pageMention: PageMention }`.
`PageLinkContext.resolve` returns an image icon as a path for image icons; render it with `PageIconView` from `../components/PageIconView` instead of the raw string if the sidebar does the same.

- [ ] **Step 6: Implement the picker**

```tsx
// src/renderer/src/editor/menus/PagePicker.tsx
import type { DefaultReactSuggestionItem, SuggestionMenuProps } from '@blocknote/react'
import { Fragment } from 'react'
import { PageIconView } from '../../components/PageIconView'

export type PickerItem = DefaultReactSuggestionItem & { key: string; path?: string; pageIcon?: string }

export function PagePicker({
  items,
  selectedIndex,
  onItemClick
}: SuggestionMenuProps<PickerItem>): React.JSX.Element {
  return (
    <div className="menu page-picker" role="listbox">
      <div className="menu-section">Link to page</div>
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {item.key === 'create' && <div className="menu-separator" />}
          <button
            type="button"
            role="option"
            aria-selected={i === selectedIndex}
            className={`menu-item ${i === selectedIndex ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onItemClick?.(item)}
          >
            <span className="menu-item-icon">
              {item.key === 'create' ? '+' : <PageIconView icon={item.pageIcon} />}
            </span>
            <span className="menu-item-label">{item.title}</span>
            {item.path && <span className="menu-item-hint">{item.path}</span>}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
```

In `Editor.tsx`, build the items from the store and add two controllers inside `BlockMenuHost`:

```tsx
function usePickerItems(
  editor: AppEditor,
  createLinkedPage?: (title: string) => Promise<string>
): (query: string) => Promise<PickerItem[]> {
  const tree = useApp((s) => s.tree)
  const recent = useApp((s) => (s.workspace && s.settings?.recent[s.workspace.root]) || NO_RECENT)
  return useCallback(
    async (query: string) => {
      const insert = (href: string, title: string): void => {
        editor.insertInlineContent([{ type: 'pageMention', props: { href, title } }, ' '])
      }
      const pages = flattenPages(tree)
      const items: PickerItem[] = rankPages(pages, recent, query).map((p) => ({
        key: p.id,
        title: p.title || 'Untitled',
        path: p.path,
        pageIcon: p.icon,
        onItemClick: () => insert(pageLinkHref(p.id), p.title)
      }))
      const title = query.trim()
      if (title && createLinkedPage) {
        items.push({
          key: 'create',
          title: `New page "${title}"`,
          onItemClick: () => void createLinkedPage(title).then((href) => insert(href, title))
        })
      }
      return items
    },
    [editor, tree, recent, createLinkedPage]
  )
}

function flattenPages(nodes: PageNode[], parents: string[] = []): PickerPage[] {
  return nodes.flatMap((n) => [
    { id: n.id, title: n.title, icon: n.icon, path: parents.join(' / ') },
    ...flattenPages(n.children, [...parents, n.title || 'Untitled'])
  ])
}
```

```tsx
              <SuggestionMenuController
                triggerCharacter="@"
                getItems={pickerItems}
                suggestionMenuComponent={PagePicker}
                onItemClick={(item) => item.onItemClick()}
              />
              <SuggestionMenuController
                triggerCharacter="[["
                getItems={pickerItems}
                suggestionMenuComponent={PagePicker}
                onItemClick={(item) => item.onItemClick()}
              />
```

Define `const NO_RECENT: string[] = []` at module level (zustand selectors must return stable references), and add `createLinkedPage?(title: string): Promise<string>` to `EditorProps`.
Hide both pickers in read-only pages by rendering the controllers only when `props.editable !== false`.

- [ ] **Step 7: Create linked pages from `PageEditor`**

In `PageEditor.tsx`, pass:

```tsx
      createLinkedPage={async (title) => {
        await save('auto')
        const node = await api.invoke('page:create', { parentId: doc.id, title })
        void useApp.getState().setExpanded(doc.id, true)
        return pageLinkHref(node.id)
      }}
```

- [ ] **Step 8: Style mentions and the picker**

Append to `editor.css`:

```css
/* ---------- Page mentions ---------- */
.nb-mention {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  border-radius: 3px;
  cursor: pointer;
}
.nb-mention:hover {
  background-color: var(--bn-colors-hovered-background);
}
.nb-mention-icon {
  font-size: 0.95em;
}
.nb-mention-title {
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: var(--nb-link-underline);
  text-underline-offset: 2px;
}
.nb-mention[data-missing] {
  color: var(--nb-muted);
  cursor: default;
}
.menu.page-picker {
  position: static;
  width: 324px;
  max-width: none;
}
```

- [ ] **Step 9: Run the tests**

Run: `pnpm test:e2e e2e/mentions.spec.ts e2e/slash.spec.ts`
Expected: PASS.
If the `[[` trigger does not open (BlockNote's trigger detection compares the typed character with the text before it), confirm in `node_modules/@blocknote/core/src/extensions/SuggestionMenu/SuggestionMenu.ts` around `handleTextInput` and adjust.

- [ ] **Step 10: Commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/renderer/src e2e/mentions.spec.ts
git commit -m "Link pages with @ and [[ as mentions that open and follow renames"
```

### Task 17: Notion paste keeps mentions

**Files:**
- Modify: `src/shared/notion/records.ts`, `src/shared/notion/records.test.ts`

**Interfaces:**
- Consumes: `pageIdFromHref` from `../core/links`, `PageMentionInline` (Task 15).

- [ ] **Step 1: Change the expectation in the existing test**

In `records.test.ts`, test `maps rich text marks, colors and mentions`, change the expected Markdown to:

```ts
        '[Plans](nobsidian://page/page-1 "mention") @March 14, 2026 $x^2$\n'
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/shared/notion/records.test.ts`
Expected: FAIL, the output has a plain link.

- [ ] **Step 3: Map page mentions to mentions**

In `records.ts`, in the `case 'p':` branch, after `href = this.ctx.link(...)`:

```ts
          case 'p': {
            const id = String(arg)
            const notionId = id.replace(/-/g, '')
            const link = this.ctx.link(`https://www.notion.so/${notionId}`, id)
            const title = this.names.pages.get(notionId) ?? 'Untitled'
            if (pageIdFromHref(link)) {
              replaced = { type: 'pageMention', props: { href: link, title } }
            } else {
              href = link
              replaced = this.styled(title, styles)
            }
            break
          }
```

- [ ] **Step 4: Run the Notion tests and commit**

Run: `pnpm vitest run src/shared/notion && pnpm typecheck && pnpm lint`

```bash
git add src/shared/notion
git commit -m "Paste Notion page mentions as mentions"
```

### Task 18: Ship PR 3

- [ ] **Step 1: Check the whole typing flow by hand in a hidden run with screenshots**

Capture the page picker, a mention, and a block selection in light and dark mode, and compare with Notion.

- [ ] **Step 2: Run the full suite twice**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm test:e2e`
Expected: everything passes both times.

- [ ] **Step 3: Push and open the PR (after the user approves)**

```bash
git push -u origin notion-typing
gh pr create --repo Dale1201/nobsidian --base main --title "Notion typing: mentions, Markdown shortcuts and keyboard commands" --body "<summary of Tasks 12-17 and how they were tested>"
```
