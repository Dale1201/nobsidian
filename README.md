# Nobsidian

An open-source, Notion-like note-taking app for macOS.
Your notes are plain Markdown files in a folder you choose, so they stay yours.

## Features

- Notion-style block editor: `/` commands, drag handles, toggles, callouts, columns, tables, code, math.
- Nested pages in a sidebar, with emoji or image icons and page covers.
- Notion's look, in light and dark mode.
- Favorites, and deleted pages go to a trash folder instead of disappearing.

Search, page history, a trash panel and Notion import are coming next.

## Development

Requires Node 24 (see `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm dev          # run the app with hot reload
pnpm test         # unit tests
pnpm test:e2e     # end-to-end tests against the built app
pnpm test:packaged # package the app and check it launches
pnpm lint
pnpm typecheck
pnpm build:mac    # Apple Silicon .dmg in dist/
```

The app is ad-hoc signed rather than signed with an Apple Developer ID, so a downloaded copy needs right-click → Open the first time you launch it.

## How notes are stored

Each page is a `.md` file; a page's child pages live in a folder with the same name.
Images and files go in `attachments/`, and app data (favorites, page order, trash) lives in `.nobsidian/`.
Notion-only formatting uses small Markdown extensions, described in `docs/superpowers/specs/2026-10-21-nobsidian-design.md`.
Opening an existing folder only adds an `id` to each note's frontmatter; a note is rewritten in Nobsidian's Markdown style only when you edit it, and anything the editor can't show (raw HTML, wikilinks, footnotes) is kept exactly as written.

## License

GPL-3.0-or-later.
