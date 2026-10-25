# Nobsidian - Drawing Block Design Spec

Date: 2026-10-25
Status: Draft for review

## 1. Purpose

The owner wants to draw rough doodles inside notes and see them inline on the page, the way Notion embeds a sketch.
Drawings must work offline, look right in both themes, and keep the page file readable in other Markdown apps.

### Success criteria

- `/drawing` opens a full-screen drawing editor; pressing Done puts the drawing on the page.
- Clicking a drawing reopens it for editing with everything intact.
- The `.md` file holds an ordinary image link, and the drawing file shows as a picture in GitHub, Obsidian and VS Code.
- Opening a page with drawings loads no drawing-editor code.
- Nothing is fetched from the network while drawing.

### Out of scope

Resizing a drawing on the page, captions, cleaning up drawing files no page uses, a gallery of drawings, collaboration, and editing drawings inline on the page.

## 2. Decisions

| Topic | Decision |
|---|---|
| Library | Excalidraw (`@excalidraw/excalidraw`), MIT licensed, free and compatible with GPL-3.0-or-later. tldraw was rejected: its SDK is source-available, needs a license key for production (the editor stops rendering after 5 seconds without one), and its free hobby key keeps a "made with tldraw" watermark and sends usage data to tldraw, none of which fits an offline GPL app. |
| Storage | One `.excalidraw.svg` file per drawing in `attachments/`: an SVG picture with the editable scene embedded by Excalidraw's `exportEmbedScene`, the format the Excalidraw VS Code extension uses. |
| Markdown | `![](attachments/Drawing.excalidraw.svg)`, an ordinary image. Any image whose path ends in `.excalidraw.svg` is a drawing. |
| Saving | Each save writes a new file and points the block at it; files are never edited in place. Page history, undo and Duplicate then always show the drawing as it was, at the cost of one leftover file per editing session, as with replaced images today. |
| Editing surface | The page shows the saved SVG as a plain image; drawing happens in a full-screen editor. |
| Dark mode | Files are always exported light, on a white background. In the app's dark theme the page image gets `filter: invert(90%) hue-rotate(180deg)`, which turns the white background into the dark page colour, and the editor uses Excalidraw's dark theme. |
| Slash menu | "Drawing" in the Media group, after Image. |
| Loading | The editor and everything that imports Excalidraw sit behind one dynamic `import()`. Fonts, including the 12 MB Xiaolai CJK font, ship with the app and are served by the main process at `nbfile://excalidraw/fonts/`. |

## 3. The page and the file

### Block

`drawing` is a custom block with `content: 'none'` and one prop, `url`, holding the internal href (`/attachments/Drawing.excalidraw.svg`) like images do.

On the page it renders an `<img>` of the file at its natural size, never wider than the page column, with no border.
Clicking it or pressing Enter while the block is selected opens the editor.
In read-only views (history preview, trashed page) it is only a picture.
In the dark theme the image carries the invert filter from section 2.

If the file does not exist, the block shows "Drawing not found" and the file name in the muted style used for missing page links, and clicking does nothing.

### Markdown

- Parse: an image paragraph whose URL, after decoding, ends in `.excalidraw.svg` (case-insensitive) becomes a drawing block; every other image stays an image.
  An `<img>` tag with such a `src` is treated the same way, so a resized drawing from another tool still opens; its width is dropped on the next save, since resizing is out of scope.
- Serialize: a drawing block becomes `![](<url>)` on its own line, followed by its children container like an image.
- Links: `links.ts` maps the drawing's `url` with the same function as an image's, so moves and renames rewrite it, and the main process converts it between internal and relative form like any attachment.

### File names

The first save of a new drawing is named `Drawing.excalidraw.svg`; later saves keep the current file's stem.
`saveAttachment` treats `.excalidraw.svg` as one extension, so a taken name becomes `Drawing (2).excalidraw.svg` rather than `Drawing.excalidraw (2).svg`.
A save of `Drawing (2).excalidraw.svg` is named `Drawing.excalidraw.svg` again, so counters never pile up as `Drawing (2) (2)`.

## 4. The editor

`DrawingEditor` is a full-window overlay above the app, loaded with `import()` the first time a drawing is opened.

- A 45px bar like the app's top bar holds the title "Drawing" (clear of the window's traffic lights) and a "Done" button on the right; Excalidraw fills the rest.
  The bar and canvas are one surface: white, or Excalidraw's dark canvas colour `#121212`.
- Cmd+Enter also closes it; Esc stays with Excalidraw, which uses it to deselect and leave tools.
- While it is open, menu commands that would navigate (new page, back, forward, search, open folder, import) do nothing; toggling the theme still works and restyles the editor.
- After Done the drawing block is selected, as Notion does, so Enter opens it again.
- The main menu is our own short `MainMenu`: clear canvas, find on canvas, help.
  Excalidraw's AI features are off.
  There is no live collaboration and no export to link, since that uploads to excalidraw.com.
  The library's "Browse libraries" link opens in the user's browser through the existing window-open handler.
- Excalidraw's own theme toggle is hidden; the theme follows the app.
- `window.EXCALIDRAW_ASSET_PATH` is `nbfile://excalidraw/` before the module loads.
- While open, the editor registers a flusher with `registerFlusher` that runs before the page editors' flushers, so quitting or closing the window saves the drawing and then the page that points at it.
- If the page file changes on disk while the editor is open, the page's editor is rebuilt and its blocks get new ids; Done then finds the drawing in the rebuilt editor by its file (and its position among drawings of that file), so the drawing still lands.
  A new drawing, which the page file does not have yet, is put back at the position it was inserted at.
  Only if no such block is left does it show "The drawing's block was gone, so it was saved as attachments/…".

### Opening and saving

1. Open: the renderer calls `drawing:read(href)`, which returns the file's text, or `null` when it is missing.
   The text is loaded with Excalidraw's `loadFromBlob`, and a hash of the elements' versions (`hashElementsVersion`) is kept.
2. Done: if that hash is unchanged, the editor closes and nothing is written.
   Otherwise it calls `exportToSvg` with `exportEmbedScene: true`, `exportBackground: true`, `viewBackgroundColor: '#ffffff'`, `exportWithDarkMode: false` and `exportScale: 1` (so the page shows it at the size it was drawn), saves the SVG text through `attachment:save`, and updates the block's `url`.
   The page then saves as usual, and Cmd+Z on the page restores the previous `url`.
3. New drawing: the slash item inserts a drawing block with an empty `url` and opens the editor on a blank canvas.
   If the editor closes without a save, the block is removed, so an empty `url` never reaches the file.
   If it somehow does (a crash mid-session), the serializer drops a drawing block with an empty `url`.
4. A file that cannot be read (permissions, an offline cloud file) opens as "Couldn't open the drawing: …" with Done enabled.
   A file that has no embedded scene (a plain SVG renamed to `.excalidraw.svg`) shows as a picture; opening it shows "This drawing can't be edited" instead of an empty canvas, so it cannot be overwritten by mistake.
5. If saving fails, the editor stays open and the error shows above it, so no drawing is lost.
6. If Excalidraw itself fails to load or render, the editor shows "Couldn't open the drawing editor: …" instead of taking the window down.
7. While the editor is open the rest of the window is `inert`, so no key or click reaches the page under it; in an error state Done has focus and Esc closes.
8. The hash is `hashElementsVersion` rather than the deprecated `getSceneVersion`, a plain sum that misses a shape replaced by another of the same version.

## 5. Main process and security

- `drawing:read(href)` resolves the href with `resolveAsset`, accepts only files ending in `.excalidraw.svg`, and returns their UTF-8 text.
  Reading through IPC means `fetch` never needs to reach workspace files.
- A Vite plugin copies Excalidraw's `dist/prod/fonts` into `out/renderer/excalidraw/fonts` at build time.
  The main process serves them at `nbfile://excalidraw/fonts/…` (from the package folder under the dev server), refusing paths outside that folder.
  The responses carry `Access-Control-Allow-Origin: *`, because Excalidraw fetches fonts with CORS from the `file://` page; the scheme gains the `corsEnabled` privilege for that.
- The CSP adds `nbfile://excalidraw` to `font-src` and a `connect-src 'self' nbfile://excalidraw`, so `fetch` reaches the fonts and nothing else in the workspace; nothing else changes.
- A `pnpm patch` of `@excalidraw/excalidraw@0.18.1` makes two changes, in both its `dev` and `prod` builds:
  1. Fonts no longer list `esm.sh` as a fallback source. Chromium requests every listed source of a `FontFace`, so without the patch each font face triggered a blocked request to the CDN.
  2. Glyph subsetting is skipped, and whole font files (one per Unicode range used) are embedded in exported SVGs. Subsetting needs `eval` (Emscripten embind) in a worker that cannot start from a `file://` page, and the CSP rightly forbids `eval` on the page. A drawing with Latin text carries about 33 KB of font; one with CJK text, about 50 KB more per range.
  The patch is tied to that exact version, so an upgrade fails `pnpm install` until it is redone.

## 6. Bundle size

Measured on `@excalidraw/excalidraw` 0.18.1: 4.4 MB of production JavaScript (1.4 MB gzipped), 145 KB of CSS, and 13 MB of fonts, of which Xiaolai is 12 MB split by Unicode range.
None of it loads at startup or when opening a page: the page image is plain `<img>`, and the editor chunk loads on first open.
An e2e test in section 7 asserts that opening the app and a page with a drawing loads no Excalidraw chunk.

## 7. Testing

### Unit

- Parse and serialize round-trip a drawing; a normal `.svg` image stays an image; a drawing block with an empty `url` is dropped.
- `links.ts` rewrites a drawing's `url` on move and rename.
- `saveAttachment` numbers `Drawing.excalidraw.svg` as `Drawing (2).excalidraw.svg`, and a save names a file after the current one without its counter.
- `drawing:read` refuses paths outside the workspace and files without the `.excalidraw.svg` suffix.

### End to end (Playwright on the built app)

- Type `/drawing`, draw a rectangle with the mouse, press Done: the page shows the image, the `.md` holds the image link, and the file on disk contains the embedded scene.
- Reopen the drawing: the rectangle is there; change it and press Done: a new file is written and the link points to it.
- Open a new drawing and close it without drawing: the block is gone and no file is written.
- Reopen and close without changes: no file is written.
- Dark theme: the page image has the invert filter and the editor opens dark.
- A drawing whose file is missing shows "Drawing not found".
- While the editor is open, no request leaves the app (fonts load locally, nothing goes to excalidraw.com).
- Opening the app and a page with a drawing loads no Excalidraw chunk.
- Enter on a selected drawing opens it; Cmd+Enter saves and closes; quitting with the editor open keeps the drawing.
- A drawing copied with Cmd+D and then edited gets its own file; the other copy keeps the old one.
- A drawing in a read-only page (Trash) does not open; a plain SVG named `.excalidraw.svg` opens as "can't be edited" and is never overwritten.
- The page file changing on disk while the editor is open still lands the drawing in the page.
- The packaged app draws with its bundled fonts (served from inside `app.asar`).

New e2e tests run with `--repeat-each=10` before the work is called done.
