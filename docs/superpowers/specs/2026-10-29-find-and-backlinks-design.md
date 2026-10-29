# Find and Replace, and Backlinks - Design

Date: 2026-10-29
Status: Approved in chat (find with replace, backlinks in a popover, approach A for both)

## Purpose

Two everyday Notion features Nobsidian lacks.
Find in page lets a long or imported page be searched and edited in place.
Backlinks show which pages link to the one open, which ties notes together.

### Out of scope

Regex, whole-word and match-case options, finding in the page title, finding in trashed pages and old versions, backlink snippets, an "expanded" backlinks mode, and counting wikilinks kept as raw text.

## Find and replace

### Behavior

- ⌘F opens a bar at the top right of the page, under the top bar, or focuses and selects its field when open.
  A selection inside one block fills the field.
- ⌥⌘F opens the bar with its replace row.
- Enter and ⇧Enter in the field, the bar's arrows, and ⌘G and ⇧⌘G anywhere step to the next and previous match, wrapping around.
- Escape in the bar closes it and selects the current match in the editor; closing removes every highlight.
- The bar shows "3/12" or "No results".
- Matching is literal and ignores case.
  It covers every text block's text, table cells and code blocks included; mention chips and equations count as a single object character, so matches never span them or cross from one block to the next.
- Matches have a soft yellow highlight and the current one a stronger orange.
  The current match scrolls to the middle of the page, and a collapsed toggle holding it opens.
- The first current match is the first one at or after the caret.
  Matches follow edits live; the current match stays the one nearest where it was.
- Replace changes the current match and moves to the next; Replace all changes every match in one step, so one ⌘Z restores them all.
  A replacement keeps the formatting of the text it replaces.
- Replace is disabled while an AI Writer suggestion is waiting.
- Each tab has its own bar; leaving the page closes it.

### Structure

- `renderer/src/editor/find/matches.ts`: `findMatches(doc, query)`, pure, returning `{ from, to }` ranges in document order.
- `renderer/src/editor/find/findPlugin.ts`: a BlockNote extension holding `{ query, matches, current }` in ProseMirror plugin state, drawing decorations, and exposing commands to set the query, step, replace and replace all.
  Highlights are decorations, so the document is never touched by finding.
- `renderer/src/components/FindBar.tsx`: the bar, rendered by `PageView` inside `.main`, talking to the editor through the page editor handle.
- Menu: an explicit Edit menu replaces `role: 'editMenu'`, with the same items plus a Find submenu (Find…, Find and Replace…, Find Next, Find Previous).
  The commands reach the active tab's `PageView` through a window event, as file attachments do.

## Backlinks

### Behavior

- Under the title, a page linked from other pages shows "↗ 3 backlinks"; with none, nothing shows.
- Clicking it opens a popover listing each linking page's icon, title and parent path, sorted by title.
  Clicking a row opens that page; ⌘-click and middle-click open it in a new tab, as links do.
- A link is any inline link or `@` mention to the page, or a page link block.
  A parent's sub-page block does not count, as in Notion, but a parent that also mentions or links the page inline does.
  A page's links to itself and links from trashed pages do not count.
- The count updates live as any tab saves, as pages are renamed, moved, trashed or restored, and as other apps edit files.

### Structure

- `shared/core/pageLinks.ts`: `pageLinkTargets(blocks)` lists each page link href with whether it only appears as a page link block.
- `main/workspace/backlinks.ts`: `LinkGraph` keeps, for each page path, the workspace paths its text links to, cached against the exact text the workspace last saw.
  `WorkspaceCore` feeds it from the blocks it already parses for the search index, so the startup index warms it; a query re-parses only pages whose text changed since.
  Because the graph is keyed by paths and checked against the text cache, renames and moves need nothing extra: `LinkRewriter` rewrites the linking files, and their new text is what the next query sees.
- `Workspace.backlinks(id)` waits for the background index, as search does, and returns page ids; IPC `page:backlinks`.
- `renderer/src/components/Backlinks.tsx`: the line and popover.
  It refetches, debounced, when the tree changes, when a page changes on disk, and when any tab saves.

## Testing

- Unit: `findMatches` (case, tables, code, atoms, block edges, non-1:1 lowercasing), `pageLinkTargets`, and `Workspace.backlinks` (mentions, inline links, link blocks, sub-page exclusion, self-links, trash, rename, move, external edit).
- End-to-end: find counts and steps, Escape selects the match, a match in a collapsed toggle opens it, Replace and Replace all with one ⌘Z, tabs keep separate bars; backlinks appear after a mention is typed in another page, the popover opens the linking page, and a sub-page alone shows none.
