# Nobsidian - Notion Polish Design Spec

Date: 2026-10-22
Status: Draft for review

## 1. Purpose

After using Nobsidian day to day, the owner finds it less polished and less easy to use than Notion.
This spec closes that gap in the four areas the owner named: list styling, editor menus, sidebar navigation, and typing (page links, Markdown shortcuts, keyboard commands).
The target is Notion's current Mac app, in light and dark mode.

### What we found

An audit with screenshots and computed styles (2026-10-22) showed the base metrics already match Notion: 240px sidebar, 30px rows at 14px, 45px top bar, 16px body text with 24px line height.
The gaps are in behaviour and in BlockNote's built-in UI, which was never replaced:

- Nested blocks show BlockNote's vertical guide line, which Notion does not have.
- Bullets do not change shape with depth, numbered lists do not change format with depth, and checkboxes are the browser's default control.
- The `/` menu uses BlockNote's large two-line items with "⌘-ALT-1" badges.
- The selection toolbar and the ⋮⋮ block menu are BlockNote's defaults, with no Turn into, Duplicate or search.
- Opening a nested page does not expand its parents in the sidebar, so the current page is often not visible or highlighted.
- `>` makes a quote instead of a toggle, Cmd+Shift+↑/↓ and Cmd+D do nothing, Cmd+Option+number does not match Notion, and there is no `@` or `[[` page linking.

### Success criteria

- Side by side with a Notion page, lists, checkboxes, toggles and menus are indistinguishable at a glance, in both themes.
- Every Notion habit listed in section 6 works the same way in Nobsidian.
- Opening any page, by any route, shows and highlights it in the sidebar.
- Files stay plain, readable Markdown; nothing written by this work needs the app to be understood.

### Out of scope

Databases, AI, inline equations, comments, typographic auto-replacements (such as `->` to →), and Notion's `@` dates and people.

## 2. Decisions

| Topic | Decision |
|---|---|
| Menus | Replace BlockNote's suggestion menu, drag handle menu and formatting toolbar with our own React components, plugged into BlockNote's controllers. CSS-only restyling was rejected because it cannot fix item layout, missing actions or behaviour. |
| Shared menu kit | One set of menu components serves the sidebar, top bar and editor, so every menu looks and behaves the same. |
| Page mentions | A custom inline content type that shows the page's icon and current title, saved as a standard Markdown link marked with the title attribute `"mention"`. |
| Reference values | Sizes, colours and spacing are measured from Notion's web app in the in-app browser, in both themes, not guessed. |
| Delivery | One spec and one plan, shipped as three PRs: (1) lists, menu kit and editor menus, (2) sidebar, (3) typing. |

## 3. Lists and blocks

- Remove BlockNote's nesting guide line everywhere.
  The existing callout rule that hides it inside callouts becomes redundant and is removed with it.
- Nested blocks align under the parent's text, using Notion's indent.
- Bullets cycle by depth: • (disc), ◦ (circle), ▪ (square), then repeat.
  Each marker sits in a fixed-width column, centred on the first line of text.
- Numbered lists cycle by depth: decimal (1.), lower alpha (a.), lower roman (i.), then repeat.
- Checkboxes are drawn, not native.
  Unchecked shows a thin outline in the text colour, with a light hover background.
  Checked shows a Notion-blue fill and a white tick, and the text turns muted with a strikethrough.
  Dark mode has matching values.
- Toggles use Notion's triangle, marker column, hover background and rotation.
  An empty open toggle shows the placeholder "Empty toggle. Click or drop blocks inside."

## 4. Shared menu kit

A replacement for today's `Popover` and `Menu` in `src/renderer/src/components/Popover.tsx`, used by every menu in the app.

- Keyboard: ↑/↓ move the highlight, Enter selects, Esc closes, → opens a submenu, ← closes it.
- Mouse hover and keyboard highlight are one state, so they never disagree.
- Optional parts: search box that filters items, section headers, submenus, and right-aligned muted shortcut hints.
- Notion's row height, font size, icon size, corner radius, padding and shadow.
- Positioning keeps today's behaviour: below the anchor, flipping above or shifting inward when there is no room.
- The sidebar row menu, workspace menu and top bar page menu move onto the kit; the trash popover adopts its search box style.

## 5. Editor menus

### Slash menu

Replaces BlockNote's menu through `SuggestionMenuController`'s `suggestionMenuComponent`.

- One line per item: icon tile, name, and the Markdown shortcut as a muted hint (`#`, `##`, `###`, `[]`, `-`, `1.`, `>`, `"`, ` ``` `, `---`).
- Groups in Notion's order: Basic blocks, Media, Advanced.
- Typing filters by name and aliases, as today.
  "No results" shows when nothing matches, and the menu closes if nothing matches and the user types a space.
- Footer: "Type '/' on the page" and "esc".
- Width and maximum height match Notion.
  It opens under the cursor, or above it when there is no room below.

### Block menu

Replaces BlockNote's drag handle menu.

- Clicking ⋮⋮ selects the block (blue tint) and opens the menu:
  - "Search actions…" box
  - The block type as a header
  - Turn into ▸: Text, Heading 1-3, Bulleted list, Numbered list, To-do list, Toggle list, Toggle heading 1-3, Code, Quote, Callout, Block equation
  - Color ▸: text colours and background colours, each with Default
  - Duplicate (⌘D)
  - Delete
- Dragging by ⋮⋮ still moves the block.
- Clicking + inserts a block below and opens the slash menu.
  Option-click inserts above.

### Selection toolbar

Replaces the default formatting toolbar items.

- Order: Text ▾ (current block type, opens Turn into), Link, Bold, Italic, Underline, Strikethrough, Code, Color (A ▾).
- Each button has a tooltip with its shortcut, such as "Bold ⌘B".
- The existing link toolbar and colour picker behaviour stay.

## 6. Typing

### Page mentions

- `@` and `[[` open the same page picker, built on the menu kit.
  It lists pages matching the query with their parent path muted, and recent pages when the query is empty.
  The last item is New page "…", which creates a sub-page of the current page with that title and mentions it.
- A mention renders inline as the page's icon (or the default page icon) and its current title, underlined faintly, at Notion's weight.
  Clicking it opens the page.
  A mention whose page no longer exists renders muted and does nothing on click.
- Markdown form: `[Title](relative/path.md "mention")`.
  On read, a link with the `"mention"` title to a workspace page becomes a mention; any other link stays a link.
  On write, the title is refreshed from the page tree.
- Mentions follow the same path rewriting as other internal links when pages move or are renamed.
- Notion paste maps Notion's page mentions to mentions.

### Markdown shortcuts

| Type | Result |
|---|---|
| `-`, `*` or `+`, then space | Bulleted list |
| `1.`, then space | Numbered list |
| `[]` | To-do |
| `>`, then space | Toggle list |
| `"`, then space | Quote |
| `#`, `##`, `###`, then space | Heading 1-3 |
| `---` | Divider |
| ` ``` ` | Code block |
| `**text**`, `*text*`, `` `text` ``, `~text~` | Bold, italic, code, strikethrough |

The audit saw `-` then space produce a paragraph in one case; the plan starts by reproducing that.

### Keyboard commands

| Keys | Action |
|---|---|
| Cmd+K, Cmd+P | Search. With a text selection, Cmd+K adds a link instead. |
| Cmd+/ | Opens the block menu for the current block with search focused |
| Cmd+D | Duplicates the current or selected blocks |
| Cmd+Shift+↑ / ↓ | Moves the current or selected blocks |
| Cmd+Option+0 to 8 | Turn into: 0 Text, 1-3 Heading, 4 To-do, 5 Bulleted, 6 Numbered, 7 Toggle, 8 Code |
| Cmd+Enter | Ticks a to-do, or opens or closes a toggle |
| Esc | Selects the current block |

With blocks selected after Esc: ↑/↓ move the selection, Shift+↑/↓ extend it, Backspace or Delete removes the blocks, Enter returns to editing, and Cmd+D, Cmd+/ and Cmd+Shift+↑/↓ act on the selection.

Existing shortcuts stay: Cmd+B, Cmd+I, Cmd+U, Cmd+E, Cmd+Shift+S, Cmd+Shift+H, Tab, Shift+Tab, Cmd+N, Cmd+[, Cmd+], Cmd+\ and Cmd+Shift+L.

Risk: BlockNote may not support selecting several whole blocks.
If not, block selection is built as a small ProseMirror plugin, and the plan says so.

## 7. Sidebar

- Opening a page by any route (sidebar, search, link, mention, breadcrumb, Back, Forward, new page) expands its ancestors, saves that expansion, and scrolls its row into view.
- The current row uses Notion's selected background and text weight.
- Every row shows the expand arrow on hover.
  Expanding a page without sub-pages shows a muted "No pages inside" row.
- Dragging pages: a blue line marks a drop between rows, a blue tint marks a drop inside a page, a collapsed page expands after about 500ms of hovering, and the list scrolls near its top and bottom edges.
- Favorites can expand to show their sub-pages.

## 8. Testing

- Every behaviour gets an end-to-end test in the hidden test mode, driven with real keyboard and mouse input:
  - list styling, checked through computed styles and pseudo-elements
  - mouse and keyboard flows for each menu
  - each Markdown shortcut and keyboard command, checked against the resulting block and the saved Markdown
  - sidebar reveal and highlighting from each navigation route
  - page drag and drop
- Unit tests cover mention parsing and serialising, title refresh after rename, menu filtering and the Turn into mapping.
- Reference screenshots are refreshed in both themes and reviewed side by side with Notion for pixel-level differences.
- Bug fixes found along the way start with an end-to-end reproduction.
