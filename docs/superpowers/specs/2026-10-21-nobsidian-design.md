# Nobsidian - Design Spec

Date: 2026-10-21
Status: Draft for review

## 1. Purpose

Nobsidian is a personal, open-source note-taking app for macOS that looks and feels like Notion.
The owner is a long-time Notion user who wants the same experience in an app they fully own and can extend.
It is used mainly for taking notes.
Notion-style databases, AI, mobile, and sync are explicitly out of scope for version one.

### Success criteria

- A page imported from Notion looks the same as the original when viewed side by side: blocks, nesting, colors, icons, covers and images all survive.
- Everyday note-taking (creating, nesting, editing, searching, moving pages) feels like Notion: same layout, typography, slash menu, drag handles and shortcuts.
- No data is ever lost: not on rename, move, delete, crash, or edits made outside the app.
- Notes stay readable as Markdown files without the app.

## 2. Decisions

| Topic | Decision |
|---|---|
| Base | New app, not a fork. Obsidian is closed source; existing open-source Notion alternatives (AFFiNE, AppFlowy, SiYuan) are either much larger than needed or built around databases. |
| Platform | macOS desktop only for version one. |
| Stack | Electron, React, TypeScript (strict), BlockNote editor (built on Tiptap/ProseMirror). |
| Storage | Markdown files in a user-chosen folder, with small extensions for Notion-only formatting. |
| Import | Notion "HTML" workspace export (zip) plus formatting-preserving paste from Notion. |
| Name | Nobsidian. Public repo `Dale1201/nobsidian`. |
| License | GPL-3.0-or-later, required because BlockNote's multi-column package is GPL-3.0. |

## 3. Scope

### Version one

- Block editor with `/` menu, Markdown shortcuts, drag handles, block type conversion and nesting.
- Sidebar with a nested page tree, emoji or image page icons, and page covers.
- Notion's look, in light and dark mode.
- Quick search (Cmd+K / Cmd+P) with recent pages.
- Favorites.
- Trash with restore.
- Page history with restore.
- Table of contents block.
- Notion workspace import and paste from Notion.

### Later (not version one)

- Claude AI inside the editor (write, rewrite, continue, summarize), like Notion AI.
- Live import from Notion through its API.
- Databases.
- Tabs, multiple windows, comments, page templates, per-page fonts and small text.
- Bookmark cards, backlinks.
- Mobile app and built-in sync.
- Code signing and notarization.

## 4. Architecture

```
┌──────────────── Electron app ────────────────┐
│ Renderer (React UI)                          │
│   Sidebar · Editor (BlockNote) · Search      │
│              │ typed IPC bridge (preload)    │
│ Main process (owns the disk)                 │
│   Workspace · File watcher · History · Trash │
│   Search index · Importer (worker thread)    │
└──────────────────────────────────────────────┘
          src/shared/core: Markdown <-> blocks converter
```

- Only the main process touches the filesystem.
  The renderer runs with context isolation on and no Node integration, and talks to the main process through a small typed API exposed by the preload script.
- `src/shared/core` holds the converter between our Markdown dialect and BlockNote's block JSON.
  It is pure TypeScript with no Electron or DOM dependency, so the editor, the importer and the tests all share one implementation.
- The importer runs in a Node worker thread so a large import never blocks the UI.
- Autosave writes about 500 ms after typing stops, and immediately when leaving a page or quitting.
  Every write goes to a temporary file in the same folder and is then renamed over the target, so a crash cannot leave a partial file.

### Repository layout

```
nobsidian/
├── src/main/          workspace, history, trash, search, importer, ipc handlers
├── src/preload/       typed bridge
├── src/renderer/      React app (sidebar, editor, search, panels, theme)
├── src/shared/core/   Markdown dialect parser/serializer, page and block types
├── tests/             unit and integration tests, fixtures (incl. Notion export)
└── e2e/               Playwright tests driving the built app
```

Tooling: pnpm, electron-vite, Vitest, Playwright (Electron mode), ESLint, Prettier, electron-builder producing an unsigned `.dmg` for Apple Silicon.
Renderer state uses Zustand.
Styling uses plain CSS with theme tokens as CSS variables.

## 5. Storage format

### Workspace folder

The user picks a workspace folder on first run ("Create new workspace" or "Open folder").
One workspace is open at a time; another can be opened from the workspace menu.

```
My Notes/
├── Getting Started.md
├── Projects.md                 the "Projects" page
├── Projects/                   child pages of "Projects"
│   └── Website Redesign.md
├── attachments/                images and files used by any page
└── .nobsidian/                 app data that travels with the workspace
    ├── workspace.json          favorites, sibling order
    ├── history/<page-id>/      page snapshots
    └── trash/                  deleted pages
```

- A page is a `.md` file.
  Its child pages live in a folder with the same name beside it.
- A folder without a matching `.md` file (for example created in Finder) becomes a page: the app creates the empty `.md` file with an id when it first sees the folder, so the page keeps a stable id.
- `attachments/` at the workspace root holds all images and files.
  Pasted or imported files keep their original name, with a numeric suffix if the name is taken.
- Non-Markdown files outside `attachments/` and `.nobsidian/` are ignored.

### Page file

```markdown
---
id: 7f3c9a2e-4b1d-4c8e-9f2a-1d3e5b7c9a0f
icon: 🚀
cover: attachments/cover.jpg
---
Body in Markdown.
```

- `id` is a UUID assigned when the page is created or first seen, and never changes.
  When an existing file without an id is first seen, only an `id:` line is added to its frontmatter (or a minimal frontmatter is prepended); the rest of the file is left byte for byte.
  A page is rewritten in Nobsidian's canonical Markdown only when it is edited in the app.
  It keys history, favorites and ordering, so they survive renames and moves.
- `icon` is an emoji or a path to an image in `attachments/`.
- `cover` is a path to an image in `attachments/`.
- `notionId` is the page's Notion id (32 hex digits), set on pages imported from Notion so pasted Notion links can find them.
- The page title is the filename without `.md`.
  Characters macOS does not allow, or that we reserve (`/ \ : * ? " < > |`, a leading `.`), are replaced with `-`, and the exact title is stored in a `title` field in the frontmatter.
  Siblings with the same title get ` (2)`, ` (3)` and so on.
  At the workspace root the name `attachments` is reserved, so a page titled `attachments` is saved as `attachments (2).md` with `title: attachments`.
- Renaming a page renames its file and its child folder.
  Moving a page moves both.
  In both cases every link to the page, and every attachment link inside the moved pages, is rewritten.
- Inside the app, links to pages use the page id (`nobsidian://page/<id>`) and links to files use workspace-root paths (`/attachments/x.png`).
  The main process converts them to relative paths when it writes a file and back when it reads one, so renaming or moving a page never leaves stale links in an open editor.

### Workspace data

- `.nobsidian/workspace.json` stores favorites (page ids) and sibling order (parent id or `root` to an ordered list of child ids).
  Pages missing from the order list are appended alphabetically.
- Per-machine UI state (expanded tree nodes, recent pages, sidebar width, window bounds, theme override) lives in Electron's `userData` folder, so two Macs syncing the workspace through iCloud or Dropbox never conflict over it.

### Markdown dialect

Base: CommonMark plus GFM (tables, task lists, strikethrough), frontmatter, and math.
Parsing and serializing use unified/remark (`remark-parse`, `remark-gfm`, `remark-math`, `remark-stringify`) with custom handling for the extensions below; frontmatter is split off and parsed with `yaml`.

| Content | Syntax |
|---|---|
| Headings 1-6 (the `/` menu offers 1-3), paragraph, bold, italic, strike, inline code, link, hard line break | Standard Markdown |
| Empty paragraph (blank line kept for spacing) | `&nbsp;` on its own line |
| Underline | `<u>text</u>` |
| Text color | `<span data-color="red">text</span>` |
| Highlight (background color) | `<span data-bg="yellow">text</span>` |
| Block text or background color | Trailing comment on the block's text: `Text<!-- color=red bg=yellow -->` (invisible in other Markdown apps) |
| Children of a block that has no Markdown nesting (paragraph, heading, code...) | `<div data-children>` right after the block, children inside, separated by blank lines |
| Bulleted, numbered, to-do lists | Standard / GFM task lists, nesting by indentation |
| Toggle | `<details>`, `<summary>title</summary>`, blank line, child blocks, `</details>` |
| Toggle heading | `<details data-heading="2">` with the same structure |
| Quote | `> text` |
| Callout | `> [!callout] 💡` first line, optionally `> [!callout:blue_bg] 💡`, followed by `>` content lines |
| Divider | `---` |
| Code block | Fenced block with language |
| Math | `$inline$` and `$$` block |
| Table | GFM table; line breaks inside cells become `<br>` |
| Image | `![caption](attachments/x.png)`, or `<img src="..." alt="..." width="480">` when resized |
| File | `[report.pdf](attachments/report.pdf "file")` on its own line |
| Video / audio | `<video src="..." controls></video>` / `<audio src="..." controls></audio>`, caption in `data-caption` |
| Columns | `<div data-columns>` containing one `<div data-column data-width="0.5">` per column, inner Markdown separated by blank lines |
| Table of contents | `<nav data-toc></nav>` on its own line; the app renders it from the page's headings, so it never goes stale |
| Link to sub-page (page block) | `[Website Redesign](Projects/Website%20Redesign.md "page")` on its own line |
| Inline link to a page | `[Website Redesign](Projects/Website%20Redesign.md)` |

Colors use Notion's palette names: `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`.
Links between pages are relative paths with spaces encoded as `%20`.

Invariants, enforced by tests:

- `parse(serialize(doc))` equals `doc` for every supported block and style.
- `serialize(parse(md))` equals `md` for Markdown in canonical form.
- Markdown the editor cannot represent (raw HTML, footnotes, wikilinks, inline images, reference links) is kept as a raw block holding the author's exact text, and written back unchanged, never dropped.

Known, accepted normalizations:

- Whitespace at the edge of bold, italic or strikethrough text moves just outside the mark, because CommonMark cannot express `**word **`.
- Inline code cannot carry other styles (BlockNote's code mark excludes the others).
- Unknown inline HTML is shown as plain text.

## 6. Editor and UI

### Layout

Same structure as Notion's desktop app.

- **Sidebar:** workspace name and menu, Search (Cmd+K), Favorites, Pages tree, "New page", Trash.
  Tree rows show expand arrow, icon and title; hovering shows `+` (new child page) and `···` (rename, duplicate, move to, delete, add to favorites).
  Pages can be dragged to reorder or nest.
  The sidebar is resizable and collapsible (Cmd+\\).
- **Top bar:** breadcrumbs, favorite star, page menu (`···`: full width, duplicate, page history, delete).
- **Banners** at the top of a page: the page is in Trash (Restore, Delete forever), the page changed outside the app (Reload, Keep mine), or its frontmatter could not be read.
- **Duplicate** copies the page and all its sub-pages with new ids, names the copy `<title> (1)`, places it directly below the original and opens it.
  Links between pages inside the copied subtree point to the copies; links to pages outside it still point to the originals.
  Attachments are shared, not copied; favorites and history are not copied.
- **Move to** opens the search modal as a picker titled "Move page to", listing every page except the page and its sub-pages, plus "Top level".
  The page becomes the last child of the chosen parent, and links are rewritten as for drag and drop.
- **Page:** optional cover (change, reposition, remove), icon (emoji picker or image), large editable title, then the block editor.
  Content column is 708 px wide; "Full width" removes the limit.

### Editor

BlockNote, with these blocks: paragraph, heading 1-3, bulleted list, numbered list, to-do, toggle, toggle heading 1-3, quote, callout, divider, code (syntax highlighting), math, table, image, file, video, audio, columns, sub-page, table of contents.
Built-in BlockNote blocks are used where they exist; callout, math, sub-page, table of contents, toggle heading (if not built in), and the colored-block wrapper are custom blocks.
Columns use `@blocknote/xl-multi-column`.

- `/` opens the block menu; Markdown shortcuts (`#`, `-`, `1.`, `[]`, `>`, ```` ``` ````, `---`) convert as you type.
- Hover handle (`⋮⋮` and `+`) to drag or insert blocks; block menu to turn into another type, color, duplicate, delete.
- Tab and Shift+Tab nest and un-nest.
- Selection toolbar: bold, italic, underline, strike, code, link, text color, highlight.
- Pasting images or dropping files saves them into `attachments/`.
- Creating a sub-page from `/page` creates the child file and inserts a page block.
- `/toc` inserts a table of contents: the page's headings (toggle headings included) indented by level, updating live; clicking one scrolls to it.
  With no headings it shows the hint "Add headings to create a table of contents."

### Look

- Notion's system font stack, sizes, line heights and spacing.
- Notion's light and dark palettes (dark background `#191919`), its 9-color text and highlight palette, and its muted hover and selection states.
- Theme follows macOS by default; Cmd+Shift+L toggles light and dark.

### Shortcuts

Cmd+N new page, Cmd+K / Cmd+P search, Cmd+\\ toggle sidebar, Cmd+[ / Cmd+] back and forward, Cmd+Shift+H last-used highlight, Cmd+Shift+L theme, plus the editor's standard formatting shortcuts.

- Cmd+K with text selected in the editor adds a link, as in Notion; otherwise it opens search.
- Cmd+Shift+H applies the last text color or highlight chosen in the toolbar (yellow highlight until one is chosen), remembered per machine.

## 7. Notion import and paste

The importer is built for a one-time migration of a workspace of up to about 1 GB.
Each run is independent: it never merges with or updates an earlier import.

### Bulk import

The user exports from Notion (Settings, Export all workspace content, or a page's `···` > Export; format HTML, include subpages, create folders for subpages, include files and images).
The export is one zip, a zip holding `Part-N.zip` zips, or several zips.

**Starting an import**

- File > Import from Notion… opens a file picker for one or more `.zip` files; it is disabled while no workspace is open.
- Dropping zips anywhere on the window makes the main process peek inside each one without extracting it.
  If it is a Notion export (`.html` pages named with 32-hex ids, or nested `Part-N.zip` zips), a dialog asks "Import N files from Notion?" with Import and Cancel.
  Dropped into the editor, the dialog also offers "Attach as file", today's behavior.
  Other zips behave as they always did.
- One import runs at a time; starting another while one runs is refused with "An import is already running."

**How it runs**

```
renderer                      main process                         worker thread
--------                      ------------                         -------------
drop zip / File > Import  ->  ImportService.start(zips)  ------->  read zips, nested and multi-part
progress panel  <-----------  forward progress  <----------------  index entries: pages, files, ids
Cancel  ------------------->  terminate worker, delete staging     each .html: hast -> blocks (shared mapper)
                                                                   copy referenced files -> staging
                              land(manifest) in Workspace.run  <-  done: manifest of pages, files, issues
sidebar tree event  <-------  wrapper page, subtree, report
```

1. A Node worker thread reads the zips with yauzl, streaming entries from disk; a nested zip is copied to a temporary file and opened the same way.
   Entry names are never used as paths on disk: staged files get generated names, so an entry like `../x` cannot escape.
2. It builds the page tree from Notion's names: pages are `Title <32-hex-id>.html` with child folders `Title <32-hex-id>/`.
   The ids resolve links and are then stripped from names.
   Each imported page gets a new UUID, and stores its Notion id as `notionId` in its frontmatter.
3. Each page is parsed into a hast tree (`hast-util-from-html`) and mapped to blocks by a pure mapper in `src/shared/notion/`, shared with paste.
   Links in the mapped blocks use internal hrefs (`nobsidian://page/<uuid>`, `/attachments/<key>`), so the worker never needs final file names.
4. Images and files the pages reference are copied into the staging folder `.nobsidian/import-<timestamp>/`.
   External images and covers (including Notion's own gallery covers) are downloaded once, with a timeout and a size cap, because the app does not load remote images.
   A failed download keeps a link to the URL and is reported.
5. Landing runs as one task on the workspace queue:
   pick the wrapper title ("Imported from Notion", or "Imported from Notion (2)" on a later run);
   move the staged files into `attachments/` with a numeric suffix where a name is taken;
   write the whole tree with final relative links into staging, rename that folder into the workspace, then write the wrapper's `.md`;
   register the pages, order and search index, and emit one tree change.
   A crash in the middle leaves at worst the complete tree under a stub wrapper page; nothing is lost.
6. Cancel works until landing starts: it terminates the worker and deletes the staging folder.
   Leftover `import-*` staging folders are deleted when a workspace opens.
   Quitting during an import asks "An import is running. Quit and discard it?"

**Mapping**

| Notion export HTML | Nobsidian block |
|---|---|
| `h1`, `h2`, `h3`, `h4` (`h1.page-title` is the page title) | Heading 1-4 |
| `p`; an empty `p` | Paragraph; empty paragraph |
| `ul.bulleted-list`, `ol.numbered-list` (with `start`), `ul.to-do-list` (`.checkbox-on` is checked) | Bulleted, numbered, to-do list items, nested by `li` children |
| `ul.toggle > li > details`; a heading as the summary | Toggle; toggle heading |
| `blockquote`; `figure.callout` (icon and body) | Quote; callout |
| `hr`; `pre > code` with its language; `figure.equation` (TeX from the KaTeX annotation) | Divider; code block; math |
| `table.simple-table` (header row and column) | Table |
| `figure.image` with caption; a file figure | Image; file |
| `div.column-list > div.column` (width from its style) | Columns |
| `figure.link-to-page`; `nav.table_of_contents` | Sub-page link; table of contents |
| `strong`, `em`, underline span, `del`, `code`, `a`, `.notion-text-equation-token` | Bold, italic, underline, strike, code, link, inline math |
| `.highlight-<color>` and `.highlight-<color>_background`; `.block-color-<color>` and `.block-color-<color>_background` | Text color and highlight; block text and background color |
| Page header icon (emoji or image) and cover | `icon` and `cover` |

Special cases:

- A database becomes a page holding a static table of its view, with titles linking to the rows, each row imported as a child page.
  Select and multi-select values keep their Notion color as a highlight, so they look like Notion's pills.
- A database row page starts with a two-column table of its properties.
- Bookmarks, embeds and video embeds become a paragraph holding a link (the title, or the URL).
- Synced blocks become their content.
- Page mentions become links to the imported page; date and person mentions become plain text (`@Name`).
- Links to Notion pages outside the export keep their `notion.so` URL and are reported.
- Breadcrumb and button blocks are skipped and reported.
- Anything unrecognized that holds text becomes plain paragraphs with that text and is reported; text is never dropped.
- A file a page references but the zips do not contain (for example a missing part) is reported and its link kept.
- A page that fails to convert is reported and becomes a page holding its plain text; the import continues.
- A zip that is corrupt or is not a Notion export fails the import before anything is written.

**Progress and report**

- A small card fixed at the bottom right shows progress without blocking editing: "Reading export…", "Converting pages · 120 of 480", "Copying images · 31 of 52", "Finishing…".
  Cancel shows until "Finishing…", then the card says "Cancelled, nothing was imported."
- At the end it says "Imported 480 pages. 3 things need a look." with Open (opens the wrapper page, expanded in the sidebar) and Open report.
  A failure shows a one-line reason ("This zip isn't a Notion HTML export.", "Not enough disk space.") and Dismiss; the workspace is untouched.
- The "Import report" page is the last child of the wrapper.
  It starts with a summary (pages, files, time taken, source zip names), then one bulleted list per kind of issue, such as "Buttons skipped (2)" or "Links to pages outside the export (4)", each item linking to the imported page it is on.

### Paste from Notion

- The editor's paste handler recognizes Notion content (Notion's private clipboard type, or `text/html` carrying Notion's markers), maps it through the same shared mapper, and inserts the blocks at the cursor.
  Other pastes behave as before.
- Notion places `text/html` and a private block format on the clipboard.
  A spike compares both against the exported fixture and picks whichever preserves more; `text/html` is the fallback.
- Pasted images (Notion's signed URLs) are downloaded by the main process into `attachments/`; a failed download keeps a link and shows a toast.
- A pasted link or mention of a page that was imported earlier points to that page, found through its `notionId`; other Notion links keep their URL.

## 8. History, trash, favorites, search

### Page history

- Snapshots are taken by the main process; a snapshot identical to the page's latest one is skipped.
  They are taken:
  1. before the app first writes to a page in a session, saving the text on disk (so content written by other tools is kept before the app canonicalizes it);
  2. while the page is being edited, at most every 10 minutes;
  3. when leaving the page, and on quit;
  4. before an external change replaces the page's text: always when the app wrote that text, otherwise at most every 10 minutes;
  5. before a restore.
- Opening the History panel first records the page as it is on disk, so the newest version is always the current one, whoever wrote it.
- Edits that cannot be saved because the page changed outside the app (leaving the page while the conflict banner is up, or choosing "Reload") are kept as a version too.
- Each version is stored as `.nobsidian/history/<page-id>/<timestamp>.md`, the exact file text, plus `<timestamp>.json` holding the page's path at that time and the page id behind each page link in it.
  Restoring resolves links through those ids, so they keep working when this page or the linked pages were renamed or moved since.
- Retention: everything for 30 days; older than that, the latest snapshot of each day is kept indefinitely.
  Pruning runs on startup.
- The History panel (top bar `···`, "Page history") is a modal like Notion's: a read-only preview on the left, versions on the right labeled "Today 2:03 PM", "Yesterday", "Oct 12" and so on.
- "Restore version" asks for confirmation, snapshots the current content, then replaces the page's content, icon and cover.
  The current title and location are kept, so a restore never moves a page.

### Trash

- Deleting a page moves its file and child folder into `.nobsidian/trash/<timestamp>-<page-id>/`, with a `meta.json` holding the original path, parent id and deletion time.
- "Trash" at the bottom of the sidebar opens a popover like Notion's: a search box filtering by title, and one row per deleted page (its sub-pages travel with it) showing icon, title, original parent and how long ago it was deleted, with Restore and Delete forever on hover.
- Clicking a row opens the page read-only under a red banner, "This page is in Trash.", with Restore and Delete forever.
  Links in that preview to its own deleted sub-pages are shown but cannot be followed.
- Restore puts the page and its sub-pages back at the original location and position (and back in Favorites if it was there), or at the end of the top level if the parent no longer exists, renaming with ` (2)` on a name conflict.
  The restored pages' own links are resolved through the page ids recorded at deletion, so pages renamed meanwhile are still found.
  When the page lands at a different path, other pages' links to its old path are rewritten, unless a newer page now has that path; those links stay with the newer page.
  The restored page opens.
- Delete forever asks first ("Permanently delete this page and its N sub-pages? This can't be undone.") and removes the entry and the history of every page in it.
- Items older than 30 days are purged on startup, like Notion.
- Links to a trashed page stay as they are and are shown as broken; they work again after restore.

### Favorites and recents

- The star in the top bar toggles a page in Favorites, shown at the top of the sidebar.
- The last 20 opened pages are kept per machine and per workspace, and shown in search before typing.

### Search

- Cmd+K, Cmd+P or "Search" at the top of the sidebar opens a centered modal like Notion's.
  Up and down move through results, Enter opens one, Esc closes.
- Before typing it lists recent pages, newest first.
- An in-memory full-text index (MiniSearch) over titles and plain-text content lives in the main process.
  Titles are searchable as soon as the workspace opens; content is indexed in the background after the window shows.
  The index is updated on every save and external change.
- Matching is by prefix, with light typo tolerance for words of 4 or more letters.
- Every page whose title matches ranks above every page that matches only in content; within each group MiniSearch's score decides.
- Each result shows icon, title, its parent pages in gray, and a one-line snippet with matches highlighted.

## 9. External changes and errors

- The main process watches the workspace with chokidar, ignoring dot-files and dot-folders (except `.nobsidian/workspace.json`), `attachments/` and the app's own temporary files.
- Events are batched for about 150 ms, then reconciled in one pass, with the disk as the source of truth:
  - An edit to a known page whose text equals the last text the app read or wrote is the app's own write and is ignored.
    Any other edit updates the text cache, search index, title and icon, and notifies the renderer.
  - A structural change (file or folder added, removed or renamed) re-walks the tree, skipping files whose modification time and size are unchanged.
    Pages are matched by their frontmatter id, so a page renamed or moved in Finder keeps its favorite, order and history.
  - When two files carry the same id (for example a sync tool's "conflicted copy"), the page already known at its path keeps the id and the other gets a fresh one.
  - New files without an id get one, adding only the `id:` line, once the file has gone a second without changing, so a file another program is still writing is never cut short.
    A known page whose id line an editor dropped keeps its identity meanwhile, matched by path.
  - An external change to `workspace.json` (another Mac syncing) reloads favorites and order.
- Every page the editor loads carries a revision number, bumped whenever the file changes other than through the editor's own saves, and every save sends it back.
  If the file changed on disk in between, the main process refuses the save, so an autosave can never silently overwrite an external edit.
- If the open page changes on disk and has no unsaved edits, it reloads silently, keeping the scroll position.
  If it has unsaved edits (typed, or still being saved), or a save was refused, a banner says "This page was changed outside Nobsidian." with "Reload" and "Keep mine".
  In both cases the version being replaced is saved to history first, so neither choice loses anything.
  Leaving the page without choosing keeps the outside version on disk and the unsaved edits in history.
- If the open page is deleted outside the app, another page opens, and any edits not yet saved go to that page's history.
- If edits cannot be saved when their page closes, not even to history (for example the disk is full or read-only), the error is shown and the page opens again with the edits and any conflict banner, as they were.
  If the page was deleted outside the app, the edits open in a new top-level page titled "Recovered edits" instead.
- A page file whose frontmatter is invalid opens with the frontmatter shown as a raw block, and a banner says "This page's frontmatter couldn't be read, so it's shown as text."
- If the workspace folder disappears (unmounted drive, moved), the app shows the welcome screen with the last path and a "Locate folder" action.

## 10. Testing

- **Unit (Vitest):** converter round-trip invariants for every block, style and color; Notion HTML mapping against a real export fixture (each fixture page's Markdown output reviewed once by hand, then pinned); export tree building and id stripping; nested and multi-part zips assembled in the test from the fixture's files; filename sanitization; link rewriting.
- **Integration (Vitest, import):** landing an import in a temp workspace (wrapper ` (2)`, attachment name clashes, every link resolving, report page); cancel leaving nothing behind; leftover staging deleted on open; external image downloads against a local HTTP server.
- **Integration (Vitest, temp folders):** workspace service create, rename, move, duplicate, delete, restore (missing parent, name conflict), delete forever and purge; history snapshot timing, dedupe, pruning and restore after renames; search ranking and snippets; external change handling (edit, add, rename, delete, conflicted copy, own writes ignored, stale save refused).
- **End-to-end (Playwright, Electron):** first run and workspace creation; create and nest pages; slash menu and Markdown shortcuts; table of contents; drag to reorder; duplicate and move to; search with recents and keyboard; favorites; trash, opening a trashed page, restore and delete forever; page history; edits made outside the app, with and without unsaved edits; the highlight shortcut; import the fixture zip through File > Import (dialog stubbed) and by dropping it, and check pages, images, colors, links and the report; cancel an import; paste the fixture's captured Notion clipboard; dark mode.
  Screenshot comparisons are checked against reference screenshots of the same content in Notion.
- **Fixture:** a small Notion test page (not personal notes, since it is committed to the public repo) containing every block type, every color, a sub-page, an image, a file and a small database, exported as HTML (`tests/fixtures/notion-export.zip`), plus the clipboard formats Notion produces when the same page is copied (`tests/fixtures/notion-clipboard/`).
- **Acceptance:** the imported fixture is compared side by side with the page in Notion; any gap goes back into the mapper and its fixture tests.

## 11. Early risks to check first

1. BlockNote coverage: toggle headings, block colors, custom blocks (callout, math, sub-page), and `xl-multi-column` behaviour.
2. Notion's clipboard formats and which one preserves the most.
3. Markdown round-trip fidelity for nested structures (lists inside toggles inside columns).

Each is a short spike before the related feature is built; findings may adjust this spec.
