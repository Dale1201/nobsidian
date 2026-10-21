# Nobsidian Plan 1: Core Note App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working macOS note app that looks and feels like Notion: a sidebar of nested pages, a Notion-style block editor, icons, covers, favorites, delete-to-trash and dark mode, with every page stored as a Markdown file in a folder the user picks.

**Architecture:** Electron with a sandboxed React renderer.
The main process owns the disk through a `Workspace` service and talks to the renderer over a typed IPC contract.
A pure TypeScript module (`src/shared/core`) converts between Markdown files and BlockNote's block JSON; the main process converts on read and write, so the renderer only ever sees blocks with internal, rename-proof link targets.

**Tech Stack:** Electron 44, electron-vite 6, Vite 8, React 19, TypeScript 7 (with TS 6 for ESLint), BlockNote 0.56 (+ Mantine 9, `@blocknote/xl-multi-column`, `@blocknote/code-block`), unified/remark, yaml, zustand, frimousse + emojibase-data, KaTeX, Vitest 5, Playwright 1.64, electron-builder 26, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-21-nobsidian-design.md`

This is plan 1 of 3.
Plan 2 covers search (Cmd+K / Cmd+P with recent pages), the Trash panel, page history and external-edit handling, plus the smaller spec items this plan leaves out: "Duplicate" and "Move to" in the sidebar page menu (Move to needs the search picker) and the Cmd+Shift+H highlight shortcut.
Plan 3 covers Notion import and paste.

## How this plan was made

Every file below was built and verified in a scratch prototype before this plan was written.
In that prototype: `pnpm typecheck` and `pnpm lint` are clean, 82 unit tests pass, the 9 app end-to-end tests passed 72 consecutive runs (one unexplained timeout was seen once earlier, see Review Focus), and `electron-builder --mac --dir` produced `Nobsidian.app`.
So the code blocks are known-good; the TDD steps still run each test red, then green, to prove the wiring in the real repo.

## Global Constraints

- macOS only, Apple Silicon (`arm64`) build target, unsigned (`mac.identity: null`).
- Node 24 for development (`.nvmrc` = `24`, `engines.node` = `>=22.22`); pnpm 10.
- Exact dependency majors: electron ^44.9.3, electron-vite ^6.0.0, vite ^8.3.4, react ^19.3.1, @blocknote/* ^0.56.0, @mantine/core ^9.7.3, vitest ^5.0.5, @playwright/test ~1.64.1, electron-builder ^26.15.3, eslint ^10.13.0.
- TypeScript is aliased: `"@typescript/native": "npm:typescript@^7.0.2"` (the `tsc` binary) and `"typescript": "npm:@typescript/typescript6@^6.0.2"` (for typescript-eslint, which refuses TS 7).
- `package.json` has `"type": "module"`; the preload is emitted as CommonJS (`out/preload/index.cjs`) because a sandboxed preload cannot load ES modules.
- Renderer security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; CSP `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: nbfile:; media-src 'self' blob: nbfile:; font-src 'self' data:`.
- `@blocknote/core` must only be loaded as ESM (its CommonJS build is broken); never `require()` it.
- License: GPL-3.0-or-later (required by `@blocknote/xl-multi-column`, which is `GPL-3.0 OR PROPRIETARY`).
- Code style: Prettier (`singleQuote`, no semicolons, `printWidth: 100`, no trailing commas); ESLint must report zero problems; explicit return types on functions.
- Comments are rare and short: only invariants, wire-format constraints, or surprising decisions.
- Never use the em dash character in code, docs or commit messages.
- Never run `git commit` without Dale's explicit permission; never add an agent co-author line.
- Page ids are UUIDs in frontmatter; links inside the editor use `nobsidian://page/<id>` and `/<workspace-root-path>`; files on disk always use relative paths.

## Review Focus

Inputs and conditions the spec implies that a person will hit, with the test that pins each one:

1. **Typing and quitting immediately** must not lose the last edit (autosave is debounced 500 ms).
   Pinned by the e2e test "edits survive a restart" in Task 8, which types and relaunches with no wait.
2. **Files edited on Windows or by other tools** (CRLF line endings, unknown frontmatter keys, footnotes, raw HTML) must open and save without losing anything.
   Pinned by `paths.test.ts` ("reads files saved with Windows line endings", "keeps unknown keys") in Task 3 and the `raw`/`footnote` cases in `convert.test.ts` in Task 2.
3. **Titles that are not valid filenames** (`A/B: C?`, a leading dot, emoji, `attachments` at the root, two pages with the same title) must save, display the exact title, and never collide.
   Pinned by `sanitizeTitle` tests in Task 3 and the "never names a root page like the attachments folder" and duplicate-title tests in Task 4.
4. **Renaming or moving a page while its links are open in the editor** must never write stale links back.
   Pinned by the workspace "renames a page with its children and rewrites links" and "serializes concurrent writes" tests in Task 4 and the e2e rename test in Task 8.
5. **A flaky end-to-end suite** hides real bugs.
   During prototyping one run in about 100 hit a single 30 s timeout that never reproduced.
   Task 8 ends with `pnpm exec playwright test --repeat-each=10`; any failure must be root-caused and fixed, not retried.

---

## File Map

| Path | Responsibility |
|---|---|
| `src/shared/core/blocks.ts` | Plain-JSON block types mirroring Nobsidian's BlockNote schema |
| `src/shared/core/processor.ts` | The single unified/remark pipeline (parse + stringify) |
| `src/shared/core/html.ts` | Attribute escaping and the block-color comment syntax |
| `src/shared/core/inline.ts` | Inline content <-> mdast phrasing (marks nesting, colors, underline) |
| `src/shared/core/parse.ts` | Markdown -> blocks (containers, callouts, lists, media, raw fallback) |
| `src/shared/core/serialize.ts` | Blocks -> Markdown |
| `src/shared/core/normalize.ts` | Reduces editor-shaped blocks to the parser's minimal form (for comparisons) |
| `src/shared/core/paths.ts` | Posix path helpers, title sanitizing, href encode/resolve/relativize |
| `src/shared/core/links.ts` | Internal page-link scheme and a deep link mapper over blocks |
| `src/shared/core/page.ts` | Frontmatter split/parse and whole-page parse/serialize |
| `src/shared/types.ts` | `PageNode`, `PageDoc`, `WorkspaceInfo`, `PageMetaPatch` |
| `src/shared/ipc.ts` | Typed IPC contract, events, `Settings` |
| `src/main/workspace/*` | Atomic file writes, `.nobsidian/workspace.json`, the `Workspace` service |
| `src/main/settings.ts` | Per-machine settings in `userData/settings.json` |
| `src/main/ipc.ts`, `handlers.ts`, `menu.ts`, `index.ts` | IPC helpers, handlers, app menu, window + `nbfile:` protocol + flush-on-quit |
| `src/preload/index.ts` | `window.api` bridge |
| `src/renderer/src/styles/*` | Notion palette tokens and app layout CSS |
| `src/renderer/src/store.ts` | zustand app store (workspace, tree, settings, navigation) |
| `src/renderer/src/lib/*` | Tree helpers, theme, asset URLs, link routing |
| `src/renderer/src/editor/*` | BlockNote schema, slash menu, link UI, emoji picker, editor CSS |
| `src/renderer/src/components/*` | Sidebar, top bar, page header/title, page view, welcome screen |
| `e2e/*` | Playwright fixtures and end-to-end tests |

---

### Task 1: Toolchain and app skeleton

Sets up the project with the verified toolchain, plus a minimal window so the build and an end-to-end smoke test run from day one.
Later tasks replace the three skeleton source files.

**Files:**
- Create: `package.json`, `.editorconfig`, `.gitignore`, `.prettierrc.yaml`, `.prettierignore`, `.nvmrc`, `electron.vite.config.ts`, `electron-builder.yml`, `eslint.config.mjs`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `playwright.config.ts`, `README.md`, `LICENSE`
- Create: `build/entitlements.mac.plist`, `build/icon.icns`, `build/icon.ico`, `build/icon.png`, `resources/icon.png` (copied from the electron-vite template)
- Create: `src/renderer/index.html`, `src/renderer/src/env.d.ts`
- Create (skeleton, replaced later): `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/main.tsx`
- Test: `e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `pnpm dev | build | typecheck | lint | test | test:e2e | build:mac` scripts; env var `NOBSIDIAN_USER_DATA` (main process sets `userData` to it, used by every e2e test); window title `Nobsidian`.

- [ ] **Step 1: Install Node 24 and confirm pnpm**

Run: `nvm install 24 && nvm use 24 && node -v && pnpm -v`
Expected: `v24.x` and `10.x`.

- [ ] **Step 2: Copy the template's icons and entitlements**

```bash
cd "$TMPDIR" && pnpm create @quick-start/electron nb-template --template react-ts --skip < /dev/null
cd /Users/d.beniga/Documents/nobsidian
mkdir -p build resources
cp "$TMPDIR/nb-template/build/"{entitlements.mac.plist,icon.icns,icon.ico,icon.png} build/
cp "$TMPDIR/nb-template/resources/icon.png" resources/
```

- [ ] **Step 3: Write the config files**


`package.json`:

````json
{
  "name": "nobsidian",
  "version": "0.1.0",
  "description": "Open-source, Notion-like note-taking app for macOS. Your notes as Markdown files.",
  "main": "./out/main/index.js",
  "author": "Dale1201",
  "homepage": "https://github.com/Dale1201/nobsidian",
  "scripts": {
    "format": "prettier --write .",
    "lint": "eslint --cache .",
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json --composite false",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json --composite false",
    "typecheck": "pnpm run typecheck:node && pnpm run typecheck:web",
    "start": "electron-vite preview",
    "dev": "electron-vite dev",
    "build": "pnpm run typecheck && electron-vite build",
    "postinstall": "install-electron && electron-builder install-app-deps",
    "build:unpack": "pnpm run build && electron-builder --dir",
    "build:mac": "pnpm run build && electron-builder --mac",
    "test": "vitest run",
    "test:e2e": "electron-vite build && playwright test"
  },
  "dependencies": {
    "@blocknote/code-block": "^0.56.0",
    "@blocknote/core": "^0.56.0",
    "@blocknote/mantine": "^0.56.0",
    "@blocknote/react": "^0.56.0",
    "@blocknote/xl-multi-column": "^0.56.0",
    "@electron-toolkit/utils": "^4.0.0",
    "@mantine/core": "^9.7.3",
    "@mantine/hooks": "^9.7.3",
    "emojibase-data": "18.0.0",
    "frimousse": "^0.4.0",
    "katex": "^0.19.0",
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "remark-gfm": "^4.0.1",
    "remark-math": "^6.0.0",
    "remark-parse": "^11.0.0",
    "remark-stringify": "^11.0.0",
    "unified": "^11.0.5",
    "yaml": "^2.9.1",
    "zustand": "^5.0.15"
  },
  "devDependencies": {
    "@electron-toolkit/eslint-config-prettier": "^3.0.1",
    "@electron-toolkit/eslint-config-ts": "^4.0.0",
    "@electron-toolkit/tsconfig": "^2.0.0",
    "@playwright/test": "~1.64.1",
    "@types/mdast": "^4.0.4",
    "@types/node": "^24.19.2",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@typescript/native": "npm:typescript@^7.0.2",
    "@vitejs/plugin-react": "^6.1.2",
    "electron": "^44.9.3",
    "electron-builder": "^26.15.3",
    "electron-vite": "^6.0.0",
    "emojibase": "18.0.0",
    "eslint": "^10.13.0",
    "eslint-plugin-react": "^7.37.5",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.7",
    "prettier": "^3.9.10",
    "typescript": "npm:@typescript/typescript6@^6.0.2",
    "vite": "^8.3.4",
    "vitest": "^5.0.5"
  },
  "type": "module",
  "productName": "Nobsidian",
  "license": "GPL-3.0-or-later",
  "engines": {
    "node": ">=22.22"
  }
}
````

`.editorconfig`:

````
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
````

`.gitignore`:

````
node_modules
dist
out
.DS_Store
.eslintcache
*.log*
test-results
playwright-report
*.tsbuildinfo
````

`.prettierrc.yaml`:

````yaml
singleQuote: true
semi: false
printWidth: 100
trailingComma: none
````

`.prettierignore`:

````
out
dist
pnpm-lock.yaml
tsconfig.json
tsconfig.*.json
````

`.nvmrc`:

````
24
````


`electron.vite.config.ts`:

````ts
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
    plugins: [react()]
  }
})
````

`electron-builder.yml`:

````yaml
appId: io.github.dale1201.nobsidian
productName: Nobsidian
directories:
  buildResources: build
files:
  - '!**/.vscode/*'
  - '!src/*'
  - '!docs/*'
  - '!electron.vite.config.{js,ts,mjs,cjs}'
  - '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,.editorconfig,.nvmrc,README.md,LICENSE}'
  - '!{.env,.env.*,.npmrc,pnpm-lock.yaml}'
  - '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
  - '!{vitest.config.*,playwright.config.*,e2e/*,test-results/*,playwright-report/*,*.tsbuildinfo}'
asarUnpack:
  - resources/**
mac:
  target:
    - target: dmg
      arch: [arm64]
  category: public.app-category.productivity
  identity: null
  entitlementsInherit: build/entitlements.mac.plist
  notarize: false
dmg:
  artifactName: ${name}-${version}-arm64.${ext}
npmRebuild: false
````

`eslint.config.mjs`:

````js
import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: '19.3'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    rules: {
      // TypeScript already checks props.
      'react/prop-types': 'off'
    }
  },
  {
    // Playwright fixtures use `use()` and empty destructuring by design.
    files: ['e2e/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'no-empty-pattern': 'off'
    }
  },
  eslintConfigPrettier
)
````

`tsconfig.json`:

````json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
````

`tsconfig.node.json`:

````json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.node.json",
  "include": [
    "electron.vite.config.*",
    "vitest.config.*",
    "playwright.config.*",
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*",
    "e2e/**/*"
  ],
  "compilerOptions": {
    "composite": true,
    "types": [
      "electron-vite/node"
    ],
    "noImplicitAny": true
  }
}
````

`tsconfig.web.json`:

````json
{
  "extends": "@electron-toolkit/tsconfig/tsconfig.web.json",
  "include": [
    "src/renderer/src/env.d.ts",
    "src/renderer/src/**/*",
    "src/renderer/src/**/*.tsx",
    "src/preload/*.d.ts",
    "src/shared/**/*"
  ],
  "exclude": [
    "**/*.test.ts"
  ],
  "compilerOptions": {
    "composite": true,
    "jsx": "react-jsx",
    "paths": {
      "@renderer/*": [
        "./src/renderer/src/*"
      ],
      "@shared/*": [
        "./src/shared/*"
      ]
    },
    "resolveJsonModule": true,
    "noImplicitAny": true
  }
}
````

`vitest.config.ts`:

````ts
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared') }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'out', 'dist', 'e2e']
  }
})
````

`playwright.config.ts`:

````ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' }
})
````

`src/renderer/index.html`:

````html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, interactive-widget=resizes-content"
    />
    <title>Nobsidian</title>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: nbfile:; media-src 'self' blob: nbfile:; font-src 'self' data:"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
````

`src/renderer/src/env.d.ts`:

````ts
/// <reference types="vite/client" />
````

`README.md`:

````markdown
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
pnpm lint
pnpm typecheck
pnpm build:mac    # unsigned Apple Silicon .dmg in dist/
```

The unsigned app needs right-click → Open the first time you launch it.

## How notes are stored

Each page is a `.md` file; a page's child pages live in a folder with the same name.
Images and files go in `attachments/`, and app data (favorites, page order, trash) lives in `.nobsidian/`.
Notion-only formatting uses small Markdown extensions, described in `docs/superpowers/specs/2026-10-21-nobsidian-design.md`.

## License

GPL-3.0-or-later.
````

- [ ] **Step 4: Add the license text**

Run: `curl -fsSL https://www.gnu.org/licenses/gpl-3.0.txt -o LICENSE && head -3 LICENSE`
Expected: the first lines read `GNU GENERAL PUBLIC LICENSE` / `Version 3, 29 June 2007`.

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: completes; the only warning is "Ignored build scripts: electron-winstaller" (harmless on macOS).

- [ ] **Step 6: Write the failing smoke test**

`e2e/smoke.spec.ts`:

````ts
import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('launches a sandboxed window titled Nobsidian', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-smoke-'))
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('Nobsidian')
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(userData)
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe(
    'undefined'
  )
  await app.close()
})
````

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm test:e2e`
Expected: FAIL, because `src/main/index.ts` does not exist yet (the build step errors).

- [ ] **Step 8: Write the skeleton app**

`src/main/index.ts` (skeleton, replaced in Task 5):

````ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

if (process.env.NOBSIDIAN_USER_DATA) app.setPath('userData', process.env.NOBSIDIAN_USER_DATA)

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Nobsidian',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (is.dev && process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
})
````

`src/preload/index.ts` (skeleton, replaced in Task 5):

````ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {})
````

`src/renderer/src/main.tsx` (skeleton, replaced in Task 8):

````tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(<h1>Nobsidian</h1>)
````

- [ ] **Step 9: Run the checks and the smoke test**

Run: `pnpm typecheck && pnpm lint && pnpm test:e2e`
Expected: typecheck and lint print no errors; Playwright reports `1 passed`.
(`pnpm test` reports "No test files found" until Task 2; that is expected.)

- [ ] **Step 10: Commit (ask Dale first)**

```bash
git add -A
git commit -m "Set up Electron, React and TypeScript toolchain"
```

### Task 2: Markdown <-> blocks converter

The heart of the app: turns Nobsidian's Markdown dialect (spec section 5) into BlockNote block JSON and back, losslessly for every supported block, style and color.

**Files:**
- Create: `src/shared/core/blocks.ts`, `src/shared/core/processor.ts`, `src/shared/core/html.ts`, `src/shared/core/inline.ts`, `src/shared/core/parse.ts`, `src/shared/core/serialize.ts`, `src/shared/core/normalize.ts`
- Test: `src/shared/core/convert.test.ts`

**Interfaces:**
- Produces:
  - `type Block`, `Inline`, `StyledText`, `LinkInline`, `InlineMath`, `TableContent`, `TableCell`, `BlockColors`, `Styles` (from `blocks.ts`); constants `DEFAULT_CALLOUT_ICON = '💡'`, `DEFAULT_CALLOUT_BACKGROUND = 'gray'`.
  - `markdownToBlocks(markdown: string): Block[]` (from `parse.ts`).
  - `blocksToMarkdown(blocks: Block[]): string` (from `serialize.ts`); returns `''` for an empty document and drops trailing empty paragraphs.
  - `normalizeBlocks(blocks: Block[]): Block[]` and `normalizeInline(content: Inline[]): Inline[]` (from `normalize.ts`).
  - `parseMarkdown`, `stringifyMarkdown`, `stringifyPhrasing` (from `processor.ts`), `cleanStyles`, `sameStyles` (from `inline.ts`).
- Block JSON shapes match BlockNote 0.56 exactly: blocks with `content: "none"` omit the `content` key; colors are omitted when `"default"`; code is exclusive of other marks.

- [ ] **Step 1: Write the failing test**


`src/shared/core/convert.test.ts`:

````ts
import { describe, expect, it } from 'vitest'
import type { Block } from './blocks'
import { markdownToBlocks } from './parse'
import { blocksToMarkdown } from './serialize'
import { normalizeBlocks } from './normalize'

const roundTrip = (md: string): string => blocksToMarkdown(markdownToBlocks(md))

describe('canonical markdown survives a round trip', () => {
  const cases: Record<string, string> = {
    paragraph: 'Hello world\n',
    headings: '# One\n\n## Two\n\n### Three\n',
    marks: 'a **bold** *italic* ~~strike~~ `code` [link](https://example.com)\n',
    nestedMarks: '**bold *both*** plain\n',
    underlineAndColor:
      'x <u>under</u> <span data-color="red">red</span> <span data-bg="yellow">hi</span>\n',
    blockColor: 'Colored<!-- color=red bg=yellow -->\n',
    emptyParagraph: 'a\n\n&nbsp;\n\nb\n',
    hardBreak: 'line one\\\nline two\n',
    bullets: '- one\n- two\n  - nested\n',
    numbered: '1. one\n2. two\n',
    numberedStart: '3. three\n4. four\n',
    todos: '- [ ] open\n- [x] done\n',
    toggle: '<details>\n<summary>Title **bold**</summary>\n\nInside\n\n</details>\n',
    toggleHeading: '<details data-heading="2">\n<summary>Section</summary>\n\nBody\n\n</details>\n',
    quote: '> quoted\n',
    callout: '> [!callout] 💡\n> Note this\n',
    calloutColors: '> [!callout:red:blue_bg] 🚀\n> Launch\n',
    calloutChildren: '> [!callout] 💡\n> Lead\n>\n> - item\n',
    divider: 'a\n\n---\n\nb\n',
    code: '```ts\nconst a = 1\n```\n',
    codeNoLang: '```\nplain\n```\n',
    math: '$$\nE = mc^2\n$$\n',
    inlineMath: 'Euler $e^{i\\pi}$ wow\n',
    table: '| a | b |\n| - | - |\n| 1 | 2 |\n',
    image: '![A cat](attachments/cat.png)\n',
    imageWidth: '<img src="attachments/cat.png" alt="A cat" width="320">\n',
    video: '<video src="attachments/clip.mp4" controls></video>\n',
    file: '[report.pdf](attachments/report.pdf "file")\n',
    pageLink: '[Website Redesign](Projects/Website%20Redesign.md "page")\n',
    columns:
      '<div data-columns>\n\n<div data-column>\n\nLeft\n\n</div>\n\n<div data-column data-width="2">\n\nRight\n\n</div>\n\n</div>\n',
    paragraphChildren: 'Parent\n\n<div data-children>\n\nChild\n\n</div>\n',
    raw: '<section>custom</section>\n',
    footnote: 'Text[^1]\n\n[^1]: The note\n'
  }
  for (const [name, md] of Object.entries(cases)) {
    it(name, () => expect(roundTrip(md)).toBe(md))
  }
})

describe('markdownToBlocks structure', () => {
  it('parses marks into styles', () => {
    expect(markdownToBlocks('**b** <u>u</u> <span data-color="red">r</span>')).toEqual([
      {
        type: 'paragraph',
        props: {},
        content: [
          { type: 'text', text: 'b', styles: { bold: true } },
          { type: 'text', text: ' ', styles: {} },
          { type: 'text', text: 'u', styles: { underline: true } },
          { type: 'text', text: ' ', styles: {} },
          { type: 'text', text: 'r', styles: { textColor: 'red' } }
        ],
        children: []
      }
    ])
  })

  it('parses a callout with colors and children', () => {
    const [callout] = markdownToBlocks('> [!callout:blue_bg] 🚀\n> Lead\n>\n> Child\n')
    expect(callout).toMatchObject({
      type: 'callout',
      props: { icon: '🚀', backgroundColor: 'blue' },
      content: [{ type: 'text', text: 'Lead', styles: {} }],
      children: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child' }] }]
    })
  })

  it('parses toggles, columns and list nesting', () => {
    const blocks = markdownToBlocks(
      '- a\n  - b\n\n<div data-columns>\n\n<div data-column>\n\n<details>\n<summary>T</summary>\n\n- inner\n\n</details>\n\n</div>\n\n<div data-column>\n\nR\n\n</div>\n\n</div>\n'
    )
    expect(blocks[0]).toMatchObject({
      type: 'bulletListItem',
      children: [{ type: 'bulletListItem' }]
    })
    expect(blocks[1]).toMatchObject({
      type: 'columnList',
      children: [
        {
          type: 'column',
          props: { width: 1 },
          children: [{ type: 'toggleListItem', children: [{ type: 'bulletListItem' }] }]
        },
        { type: 'column', children: [{ type: 'paragraph' }] }
      ]
    })
  })

  it('keeps code exclusive of other marks', () => {
    const [p] = markdownToBlocks('**`x`**')
    expect(p).toMatchObject({ content: [{ type: 'text', text: 'x', styles: { code: true } }] })
  })

  it('moves edge whitespace outside delimiter marks', () => {
    const md = blocksToMarkdown([
      {
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: ' x ', styles: { bold: true } }],
        children: []
      }
    ])
    expect(md).toBe('&#x20;**x**&#x20;\n')
  })

  it('treats empty input as an empty document', () => {
    expect(markdownToBlocks('')).toEqual([])
    expect(blocksToMarkdown([])).toBe('')
  })

  it('preserves unknown markdown as a raw block', () => {
    expect(markdownToBlocks('<section>custom</section>')).toEqual([
      { type: 'raw', props: { markdown: '<section>custom</section>' }, children: [] }
    ])
  })

  it('keeps unmatched container tags as raw blocks', () => {
    const blocks = markdownToBlocks('<div data-columns>\n\nNo close\n')
    expect(blocks[0]).toMatchObject({ type: 'raw' })
    expect(blocks[1]).toMatchObject({ type: 'paragraph' })
  })
})

describe('editor documents survive a round trip', () => {
  const editorDoc: Block[] = [
    {
      id: 'a',
      type: 'heading',
      props: { level: 1, isToggleable: false, textColor: 'default', backgroundColor: 'default' },
      content: [{ type: 'text', text: 'Title', styles: {} }],
      children: []
    },
    {
      id: 'b',
      type: 'paragraph',
      props: { textColor: 'default', backgroundColor: 'yellow' },
      content: [
        { type: 'text', text: 'Mixed ', styles: {} },
        { type: 'text', text: 'bold', styles: { bold: true } },
        { type: 'text', text: 'and', styles: { bold: true, italic: true } },
        { type: 'text', text: ' ', styles: {} },
        { type: 'text', text: 'red under', styles: { textColor: 'red', underline: true } },
        {
          type: 'link',
          href: 'https://x.dev',
          content: [{ type: 'text', text: 'link', styles: { strike: true } }]
        }
      ],
      children: [
        {
          id: 'c',
          type: 'bulletListItem',
          props: { textColor: 'default', backgroundColor: 'default' },
          content: [{ type: 'text', text: 'child', styles: {} }],
          children: []
        }
      ]
    },
    {
      id: 'd',
      type: 'callout',
      props: { icon: '💡', textColor: 'default', backgroundColor: 'gray' },
      content: [],
      children: [
        {
          id: 'e',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'inside', styles: {} }],
          children: []
        }
      ]
    },
    {
      id: 'f',
      type: 'quote',
      props: { textColor: 'default', backgroundColor: 'default' },
      content: [],
      children: [
        {
          id: 'g',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'q child', styles: {} }],
          children: []
        }
      ]
    },
    {
      id: 'h',
      type: 'table',
      props: { textColor: 'default' },
      content: {
        type: 'tableContent',
        columnWidths: [undefined, undefined],
        rows: [
          {
            cells: [
              {
                type: 'tableCell',
                props: {},
                content: [{ type: 'text', text: 'a\nb', styles: {} }]
              },
              { type: 'tableCell', props: {}, content: [] }
            ]
          },
          {
            cells: [
              {
                type: 'tableCell',
                props: {},
                content: [{ type: 'text', text: '|pipe|', styles: {} }]
              },
              { type: 'tableCell', props: {}, content: [] }
            ]
          }
        ]
      },
      children: []
    },
    {
      id: 'i',
      type: 'numberedListItem',
      props: {},
      content: [{ type: 'text', text: 'one', styles: {} }],
      children: []
    },
    {
      id: 'j',
      type: 'numberedListItem',
      props: {},
      content: [{ type: 'text', text: 'two', styles: {} }],
      children: []
    },
    { id: 'k', type: 'checkListItem', props: { checked: true }, content: [], children: [] },
    { id: 'l', type: 'paragraph', props: {}, content: [], children: [] },
    {
      id: 'm',
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text: 'spaced', styles: { bold: true } }],
      children: []
    },
    {
      id: 'n',
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text: '# not heading *not em* <b>', styles: {} }],
      children: []
    },
    { id: 'o', type: 'paragraph', props: {}, content: [], children: [] }
  ]

  it('keeps every block, style and color', () => {
    const md = blocksToMarkdown(editorDoc)
    expect(normalizeBlocks(markdownToBlocks(md))).toEqual(normalizeBlocks(editorDoc))
  })
})
````

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/shared/core/convert.test.ts`
Expected: FAIL with "Failed to resolve import ./blocks" (the modules do not exist yet).

- [ ] **Step 3: Write the implementation**


`src/shared/core/blocks.ts`:

````ts
// Plain-JSON mirror of the BlockNote document shape used by Nobsidian's schema.
// Kept free of runtime imports so main, renderer and tests can share it.

export const COLOR_NAMES = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red'
] as const
export type ColorName = (typeof COLOR_NAMES)[number]

export interface Styles {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  textColor?: string
  backgroundColor?: string
}

export interface StyledText {
  type: 'text'
  text: string
  styles: Styles
}

export interface LinkInline {
  type: 'link'
  href: string
  content: StyledText[]
}

export interface InlineMath {
  type: 'inlineMath'
  props: { latex: string }
}

export type Inline = StyledText | LinkInline | InlineMath

export interface TableCell {
  type: 'tableCell'
  props?: Record<string, unknown>
  content: Inline[]
}

export interface TableContent {
  type: 'tableContent'
  columnWidths?: (number | undefined)[]
  headerRows?: number
  headerCols?: number
  rows: { cells: (Inline[] | TableCell)[] }[]
}

export interface BlockColors {
  textColor?: string
  backgroundColor?: string
}

interface BlockBase<T extends string, P> {
  id?: string
  type: T
  props: P
  children: Block[]
}

type WithInline<T extends string, P> = BlockBase<T, P> & { content: Inline[] }
type WithoutContent<T extends string, P> = BlockBase<T, P> & { content?: undefined }

export type ParagraphBlock = WithInline<'paragraph', BlockColors>
export type HeadingBlock = WithInline<
  'heading',
  BlockColors & { level: number; isToggleable?: boolean }
>
export type BulletListItemBlock = WithInline<'bulletListItem', BlockColors>
export type NumberedListItemBlock = WithInline<'numberedListItem', BlockColors & { start?: number }>
export type CheckListItemBlock = WithInline<'checkListItem', BlockColors & { checked: boolean }>
export type ToggleListItemBlock = WithInline<'toggleListItem', BlockColors>
export type QuoteBlock = WithInline<'quote', BlockColors>
export type CalloutBlock = WithInline<'callout', BlockColors & { icon: string }>
export type CodeBlock = BlockBase<'codeBlock', { language: string }> & { content: StyledText[] }
export type TableBlock = BlockBase<'table', BlockColors> & { content: TableContent }
export type DividerBlock = WithoutContent<'divider', Record<string, never>>
export type ImageBlock = WithoutContent<
  'image',
  { url: string; caption: string; name?: string; previewWidth?: number }
>
export type VideoBlock = WithoutContent<'video', { url: string; caption: string; name?: string }>
export type AudioBlock = WithoutContent<'audio', { url: string; caption: string; name?: string }>
export type FileBlock = WithoutContent<'file', { url: string; name: string; caption?: string }>
export type MathBlock = WithoutContent<'math', { latex: string }>
export type PageLinkBlock = WithoutContent<'pageLink', { href: string }>
export type RawBlock = WithoutContent<'raw', { markdown: string }>
export type ColumnListBlock = WithoutContent<'columnList', Record<string, never>>
export type ColumnBlock = WithoutContent<'column', { width: number }>

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | BulletListItemBlock
  | NumberedListItemBlock
  | CheckListItemBlock
  | ToggleListItemBlock
  | QuoteBlock
  | CalloutBlock
  | CodeBlock
  | TableBlock
  | DividerBlock
  | ImageBlock
  | VideoBlock
  | AudioBlock
  | FileBlock
  | MathBlock
  | PageLinkBlock
  | RawBlock
  | ColumnListBlock
  | ColumnBlock

export type BlockType = Block['type']

export const LIST_ITEM_TYPES = ['bulletListItem', 'numberedListItem', 'checkListItem'] as const

export const DEFAULT_CALLOUT_ICON = '💡'
export const DEFAULT_CALLOUT_BACKGROUND = 'gray'
````

`src/shared/core/processor.ts`:

````ts
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Root, RootContent, PhrasingContent } from 'mdast'

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkStringify, {
  bullet: '-',
  emphasis: '*',
  strong: '*',
  fences: true,
  rule: '-',
  listItemIndent: 'one',
  incrementListMarker: true
})

export function parseMarkdown(markdown: string): Root {
  return processor.runSync(processor.parse(markdown)) as Root
}

export function stringifyMarkdown(children: RootContent[]): string {
  return processor.stringify({ type: 'root', children })
}

export function stringifyPhrasing(children: PhrasingContent[]): string {
  return stringifyMarkdown([{ type: 'paragraph', children }]).replace(/\n$/, '')
}
````

`src/shared/core/html.ts`:

````ts
import type { BlockColors } from './blocks'

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>'
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function unescapeAttr(value: string): string {
  return value.replace(/&(amp|quot|#39|lt|gt);/g, (m) => ENTITIES[m])
}

export function parseAttrs(tagSource: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const body = tagSource.replace(/^<\/?[a-zA-Z][\w-]*/, '').replace(/\/?>[\s\S]*$/, '')
  for (const m of body.matchAll(/([a-zA-Z][\w-]*)(?:="([^"]*)")?/g)) {
    attrs[m[1]] = m[2] === undefined ? '' : unescapeAttr(m[2])
  }
  return attrs
}

export function renderAttrs(attrs: Record<string, string | number | true | undefined>): string {
  let out = ''
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue
    out += value === true ? ` ${key}` : ` ${key}="${escapeAttr(String(value))}"`
  }
  return out
}

const BLOCK_COLOR_COMMENT = /^<!--\s*((?:(?:color|bg)=[a-z_]+\s*)+)-->$/

export function parseBlockColorComment(html: string): BlockColors | null {
  const m = BLOCK_COLOR_COMMENT.exec(html.trim())
  if (!m) return null
  const colors: BlockColors = {}
  for (const pair of m[1].trim().split(/\s+/)) {
    const [key, value] = pair.split('=')
    if (key === 'color') colors.textColor = value
    else colors.backgroundColor = value
  }
  return colors
}

export function renderBlockColorComment(colors: BlockColors): string | null {
  const parts: string[] = []
  if (isColor(colors.textColor)) parts.push(`color=${colors.textColor}`)
  if (isColor(colors.backgroundColor)) parts.push(`bg=${colors.backgroundColor}`)
  return parts.length ? `<!-- ${parts.join(' ')} -->` : null
}

export function isColor(value: string | undefined): value is string {
  return value !== undefined && value !== '' && value !== 'default'
}
````

`src/shared/core/inline.ts`:

````ts
import type { PhrasingContent } from 'mdast'
import type { BlockColors, Inline, LinkInline, StyledText, Styles } from './blocks'
import { isColor, parseAttrs, parseBlockColorComment, renderBlockColorComment } from './html'

// ---------- Markdown -> inline content ----------

interface HtmlMark {
  tag: 'u' | 'span'
  styles: Styles
}

export interface ParsedInline {
  content: Inline[]
  colors: BlockColors
}

export function phrasingToInline(nodes: PhrasingContent[]): ParsedInline {
  const out: Inline[] = []
  const htmlStack: HtmlMark[] = []
  let colors: BlockColors = {}

  const pushText = (target: Inline[], text: string, styles: Styles): void => {
    if (text === '') return
    const merged: Styles = { ...styles }
    for (const mark of htmlStack) Object.assign(merged, mark.styles)
    const clean = cleanStyles(merged)
    const last = target[target.length - 1]
    if (last && last.type === 'text' && sameStyles(last.styles, clean)) last.text += text
    else target.push({ type: 'text', text, styles: clean })
  }

  const walk = (list: PhrasingContent[], styles: Styles, target: Inline[]): void => {
    for (const node of list) {
      switch (node.type) {
        case 'text':
          pushText(target, node.value, styles)
          break
        case 'break':
          pushText(target, '\n', styles)
          break
        case 'strong':
          walk(node.children, { ...styles, bold: true }, target)
          break
        case 'emphasis':
          walk(node.children, { ...styles, italic: true }, target)
          break
        case 'delete':
          walk(node.children, { ...styles, strike: true }, target)
          break
        case 'inlineCode':
          target.push({ type: 'text', text: node.value, styles: { code: true } })
          break
        case 'inlineMath':
          target.push({ type: 'inlineMath', props: { latex: node.value } })
          break
        case 'link': {
          const link: LinkInline = { type: 'link', href: node.url, content: [] }
          const inner: Inline[] = []
          walk(node.children, styles, inner)
          link.content = inner.filter((i): i is StyledText => i.type === 'text')
          target.push(link)
          break
        }
        case 'image':
          target.push({
            type: 'link',
            href: node.url,
            content: [{ type: 'text', text: node.alt || node.url, styles: cleanStyles(styles) }]
          })
          break
        case 'html': {
          const value = node.value
          const blockColors = parseBlockColorComment(value)
          if (blockColors) {
            colors = { ...colors, ...blockColors }
          } else if (/^<u>$/i.test(value)) {
            htmlStack.push({ tag: 'u', styles: { underline: true } })
          } else if (/^<\/u>$/i.test(value)) {
            popMark(htmlStack, 'u')
          } else if (/^<span\b[^>]*>$/i.test(value)) {
            const attrs = parseAttrs(value)
            const markStyles: Styles = {}
            if (attrs['data-color']) markStyles.textColor = attrs['data-color']
            if (attrs['data-bg']) markStyles.backgroundColor = attrs['data-bg']
            htmlStack.push({ tag: 'span', styles: markStyles })
          } else if (/^<\/span>$/i.test(value)) {
            popMark(htmlStack, 'span')
          } else if (/^<br\s*\/?>$/i.test(value)) {
            pushText(target, '\n', styles)
          } else {
            pushText(target, value, styles)
          }
          break
        }
        default:
          // footnoteReference, linkReference, imageReference: keep their source-ish text
          if ('value' in node && typeof node.value === 'string')
            pushText(target, node.value, styles)
          else if ('children' in node) walk(node.children as PhrasingContent[], styles, target)
      }
    }
  }

  walk(nodes, {}, out)
  return { content: out, colors }
}

function popMark(stack: HtmlMark[], tag: HtmlMark['tag']): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].tag === tag) {
      stack.splice(i, 1)
      return
    }
  }
}

export function cleanStyles(styles: Styles): Styles {
  if (styles.code) return { code: true }
  const out: Styles = {}
  if (styles.bold) out.bold = true
  if (styles.italic) out.italic = true
  if (styles.underline) out.underline = true
  if (styles.strike) out.strike = true
  if (isColor(styles.textColor)) out.textColor = styles.textColor
  if (isColor(styles.backgroundColor)) out.backgroundColor = styles.backgroundColor
  return out
}

export function sameStyles(a: Styles, b: Styles): boolean {
  const ca = cleanStyles(a)
  const cb = cleanStyles(b)
  const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]) as Set<keyof Styles>
  for (const k of keys) if (ca[k] !== cb[k]) return false
  return true
}

// ---------- inline content -> Markdown ----------

type Mark =
  | { kind: 'bold' }
  | { kind: 'italic' }
  | { kind: 'strike' }
  | { kind: 'underline' }
  | { kind: 'textColor'; value: string }
  | { kind: 'backgroundColor'; value: string }

type Segment =
  { kind: 'text'; text: string; marks: Mark[] } | { kind: 'atom'; node: PhrasingContent }

export interface InlineToPhrasingOptions {
  /** Table cells cannot contain line breaks, so newlines become `<br>`. */
  newlineAsHtml?: boolean
  blockColors?: BlockColors
}

export function inlineToPhrasing(
  content: Inline[],
  options: InlineToPhrasingOptions = {}
): PhrasingContent[] {
  const out = segmentsToPhrasing(toSegments(content, options), options)
  const comment = options.blockColors ? renderBlockColorComment(options.blockColors) : null
  if (comment) out.push({ type: 'html', value: comment })
  return out
}

function marksOf(styles: Styles): Mark[] {
  const s = cleanStyles(styles)
  const marks: Mark[] = []
  if (s.bold) marks.push({ kind: 'bold' })
  if (s.italic) marks.push({ kind: 'italic' })
  if (s.strike) marks.push({ kind: 'strike' })
  if (s.underline) marks.push({ kind: 'underline' })
  if (s.textColor) marks.push({ kind: 'textColor', value: s.textColor })
  if (s.backgroundColor) marks.push({ kind: 'backgroundColor', value: s.backgroundColor })
  return marks
}

function toSegments(content: Inline[], options: InlineToPhrasingOptions): Segment[] {
  const segments: Segment[] = []
  for (const item of content) {
    if (item.type === 'inlineMath') {
      segments.push({ kind: 'atom', node: { type: 'inlineMath', value: item.props.latex } })
    } else if (item.type === 'link') {
      const children = segmentsToPhrasing(toSegments(item.content, options), options)
      segments.push({ kind: 'atom', node: { type: 'link', url: item.href, children } })
    } else if (item.styles.code) {
      segments.push({ kind: 'atom', node: { type: 'inlineCode', value: item.text } })
    } else {
      segments.push({ kind: 'text', text: item.text, marks: marksOf(item.styles) })
    }
  }
  return segments
}

const markKey = (m: Mark): string => ('value' in m ? `${m.kind}:${m.value}` : m.kind)
const hasMark = (seg: Segment, key: string): boolean =>
  seg.kind === 'text' && seg.marks.some((m) => markKey(m) === key)

function segmentsToPhrasing(
  segments: Segment[],
  options: InlineToPhrasingOptions,
  active: Set<string> = new Set()
): PhrasingContent[] {
  const out: PhrasingContent[] = []
  let i = 0
  while (i < segments.length) {
    const seg = segments[i]
    if (seg.kind === 'atom') {
      out.push(seg.node)
      i++
      continue
    }
    const pending = seg.marks.filter((m) => !active.has(markKey(m)))
    if (pending.length === 0) {
      out.push(...textToPhrasing(seg.text, options))
      i++
      continue
    }
    // Open the mark that stays active the longest so the tree nests cleanly.
    let best = pending[0]
    let bestEnd = i + 1
    for (const mark of pending) {
      let end = i + 1
      while (end < segments.length && hasMark(segments[end], markKey(mark))) end++
      if (end > bestEnd) {
        best = mark
        bestEnd = end
      }
    }
    const inner = segmentsToPhrasing(
      segments.slice(i, bestEnd),
      options,
      new Set([...active, markKey(best)])
    )
    out.push(...wrap(best, inner))
    i = bestEnd
  }
  return out
}

function textToPhrasing(text: string, options: InlineToPhrasingOptions): PhrasingContent[] {
  const out: PhrasingContent[] = []
  text.split('\n').forEach((part, index) => {
    if (index > 0)
      out.push(options.newlineAsHtml ? { type: 'html', value: '<br>' } : { type: 'break' })
    if (part !== '') out.push({ type: 'text', value: part })
  })
  return out
}

function wrap(mark: Mark, children: PhrasingContent[]): PhrasingContent[] {
  switch (mark.kind) {
    case 'bold':
      return wrapDelimited('strong', children)
    case 'italic':
      return wrapDelimited('emphasis', children)
    case 'strike':
      return wrapDelimited('delete', children)
    case 'underline':
      return [{ type: 'html', value: '<u>' }, ...children, { type: 'html', value: '</u>' }]
    case 'textColor':
      return [
        { type: 'html', value: `<span data-color="${mark.value}">` },
        ...children,
        { type: 'html', value: '</span>' }
      ]
    case 'backgroundColor':
      return [
        { type: 'html', value: `<span data-bg="${mark.value}">` },
        ...children,
        { type: 'html', value: '</span>' }
      ]
  }
}

// `**foo **` is not bold in CommonMark, so edge whitespace moves outside the delimiters.
function wrapDelimited(
  type: 'strong' | 'emphasis' | 'delete',
  children: PhrasingContent[]
): PhrasingContent[] {
  const inner = [...children]
  let lead = ''
  let trail = ''
  const first = inner[0]
  if (first?.type === 'text') {
    const m = /^\s+/.exec(first.value)
    if (m) {
      lead = m[0]
      inner[0] = { type: 'text', value: first.value.slice(lead.length) }
    }
  }
  const lastIndex = inner.length - 1
  const last = inner[lastIndex]
  if (last?.type === 'text') {
    const m = /\s+$/.exec(last.value)
    if (m) {
      trail = m[0]
      inner[lastIndex] = { type: 'text', value: last.value.slice(0, -trail.length) }
    }
  }
  const content = inner.filter((n) => !(n.type === 'text' && n.value === ''))
  const out: PhrasingContent[] = []
  if (lead) out.push({ type: 'text', value: lead })
  if (content.length) out.push({ type, children: content } as PhrasingContent)
  if (trail) out.push({ type: 'text', value: trail })
  return out
}
````

`src/shared/core/parse.ts`:

````ts
import type {
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  RootContent,
  Table,
  Blockquote
} from 'mdast'
import type { Block, BlockColors, Inline, TableContent } from './blocks'
import { parseAttrs, parseBlockColorComment } from './html'
import { phrasingToInline } from './inline'
import { parseMarkdown, stringifyMarkdown } from './processor'

export function markdownToBlocks(markdown: string): Block[] {
  return parseFlow(parseMarkdown(markdown).children)
}

const NBSP = ' '
const DETAILS_OPEN = /^<details(?: data-heading="([1-6])")?>\n<summary>([\s\S]*)<\/summary>$/
const DIV_OPEN = /^<div data-(columns|column|children)(?: data-width="([0-9.]+)")?>$/
const CALLOUT_MARKER = /^\[!callout((?::[a-z_]+)*)\][ \t]*([^\n]*)\n?/

function parseFlow(nodes: RootContent[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    if (node.type === 'html') {
      const container = matchContainer(node.value)
      if (container) {
        const end = findClose(nodes, i, container.family)
        if (end !== -1) {
          const inner = nodes.slice(i + 1, end)
          const built = buildContainer(container, inner, out)
          out.push(...built)
          i = end + 1
          continue
        }
      }
    }
    out.push(...parseNode(node))
    i++
  }
  return out
}

type Container =
  | { family: 'details'; heading?: number; summary: string }
  | { family: 'div'; kind: 'columns' | 'column' | 'children'; width?: number }

function matchContainer(value: string): Container | null {
  const details = DETAILS_OPEN.exec(value)
  if (details) {
    return {
      family: 'details',
      heading: details[1] ? Number(details[1]) : undefined,
      summary: details[2]
    }
  }
  const div = DIV_OPEN.exec(value)
  if (div) {
    return {
      family: 'div',
      kind: div[1] as 'columns' | 'column' | 'children',
      width: div[2] ? Number(div[2]) : undefined
    }
  }
  return null
}

function findClose(nodes: RootContent[], openIndex: number, family: 'details' | 'div'): number {
  const open = family === 'details' ? /^<details\b/ : /^<div\b/
  const close = family === 'details' ? /^<\/details>$/ : /^<\/div>$/
  let depth = 0
  for (let j = openIndex; j < nodes.length; j++) {
    const n = nodes[j]
    if (n.type !== 'html') continue
    if (open.test(n.value)) depth++
    else if (close.test(n.value.trim())) {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

function buildContainer(container: Container, inner: RootContent[], preceding: Block[]): Block[] {
  if (container.family === 'details') {
    const { content, colors } = parseInlineSource(container.summary)
    const children = parseFlow(inner)
    if (container.heading) {
      return [
        {
          type: 'heading',
          props: { level: container.heading, isToggleable: true, ...colors },
          content,
          children
        }
      ]
    }
    return [{ type: 'toggleListItem', props: { ...colors }, content, children }]
  }
  const children = parseFlow(inner)
  switch (container.kind) {
    case 'columns':
      return [
        {
          type: 'columnList',
          props: {},
          children: children.filter((c) => c.type === 'column')
        }
      ]
    case 'column':
      return [{ type: 'column', props: { width: container.width ?? 1 }, children }]
    case 'children': {
      const parent = preceding[preceding.length - 1]
      if (parent) {
        parent.children.push(...children)
        return []
      }
      return children
    }
  }
}

function parseInlineSource(source: string): { content: Inline[]; colors: BlockColors } {
  if (source.trim() === '') return { content: [], colors: {} }
  const root = parseMarkdown(source)
  const first = root.children[0]
  if (first?.type === 'paragraph') return normalizeEmpty(phrasingToInline(first.children))
  if (first?.type === 'html') {
    const colors = parseBlockColorComment(first.value)
    if (colors) return { content: [], colors }
  }
  return { content: [{ type: 'text', text: source, styles: {} }], colors: {} }
}

function normalizeEmpty(parsed: { content: Inline[]; colors: BlockColors }): {
  content: Inline[]
  colors: BlockColors
} {
  const only = parsed.content[0]
  if (parsed.content.length === 1 && only.type === 'text' && only.text === NBSP) {
    return { content: [], colors: parsed.colors }
  }
  return parsed
}

function parseNode(node: RootContent): Block[] {
  switch (node.type) {
    case 'paragraph':
      return [parseParagraph(node)]
    case 'heading': {
      const { content, colors } = phrasingToInline(node.children)
      return [{ type: 'heading', props: { level: node.depth, ...colors }, content, children: [] }]
    }
    case 'list':
      return parseList(node)
    case 'blockquote':
      return [parseBlockquote(node)]
    case 'code':
      return [
        {
          type: 'codeBlock',
          props: { language: node.lang || 'text' },
          content: node.value ? [{ type: 'text', text: node.value, styles: {} }] : [],
          children: []
        }
      ]
    case 'math':
      return [{ type: 'math', props: { latex: node.value }, children: [] }]
    case 'thematicBreak':
      return [{ type: 'divider', props: {}, children: [] }]
    case 'table':
      return [parseTable(node)]
    case 'html': {
      const media = parseMediaHtml(node.value)
      if (media) return [media]
      const colors = parseBlockColorComment(node.value)
      if (colors) return [{ type: 'paragraph', props: { ...colors }, content: [], children: [] }]
      return [rawBlock(node)]
    }
    default:
      return [rawBlock(node)]
  }
}

function rawBlock(node: RootContent): Block {
  return {
    type: 'raw',
    props: { markdown: stringifyMarkdown([node]).replace(/\n+$/, '') },
    children: []
  }
}

function parseParagraph(node: Paragraph): Block {
  const kids = node.children
  if (kids.length === 1 && kids[0].type === 'image') {
    return {
      type: 'image',
      props: { url: kids[0].url, caption: kids[0].alt ?? '' },
      children: []
    }
  }
  if (kids.length === 1 && kids[0].type === 'link' && kids[0].title === 'page') {
    return { type: 'pageLink', props: { href: kids[0].url }, children: [] }
  }
  if (kids.length === 1 && kids[0].type === 'link' && kids[0].title === 'file') {
    const name = kids[0].children.map((c) => ('value' in c ? c.value : '')).join('')
    return { type: 'file', props: { url: kids[0].url, name }, children: [] }
  }
  if (hasUnsupportedPhrasing(kids)) return rawBlock(node)
  if (kids.length > 0 && kids.every((k) => k.type === 'html')) {
    const media = parseMediaHtml(kids.map((k) => (k as { value: string }).value).join(''))
    if (media) return media
  }
  const { content, colors } = normalizeEmpty(phrasingToInline(kids))
  return { type: 'paragraph', props: { ...colors }, content, children: [] }
}

const UNSUPPORTED_PHRASING = new Set(['footnoteReference', 'linkReference', 'imageReference'])

function hasUnsupportedPhrasing(nodes: PhrasingContent[]): boolean {
  return nodes.some(
    (n) =>
      UNSUPPORTED_PHRASING.has(n.type) ||
      ('children' in n && hasUnsupportedPhrasing(n.children as PhrasingContent[]))
  )
}

function parseMediaHtml(value: string): Block | null {
  const html = value.trim()
  if (/^<img\b[^>]*>$/i.test(html)) {
    const a = parseAttrs(html)
    const width = a.width ? Number(a.width) : undefined
    return {
      type: 'image',
      props: {
        url: a.src ?? '',
        caption: a.alt ?? '',
        ...(width ? { previewWidth: width } : {})
      },
      children: []
    }
  }
  const media = /^<(video|audio)\b[^>]*><\/\1>$/i.exec(html)
  if (media) {
    const a = parseAttrs(html)
    const type = media[1].toLowerCase() as 'video' | 'audio'
    return { type, props: { url: a.src ?? '', caption: a['data-caption'] ?? '' }, children: [] }
  }
  return null
}

function parseList(list: List): Block[] {
  const out: Block[] = []
  list.children.forEach((item, index) => out.push(parseListItem(list, item, index)))
  return out
}

function parseListItem(list: List, item: ListItem, index: number): Block {
  let rest = item.children
  let content: Inline[] = []
  let colors: BlockColors = {}
  const first = rest[0]
  if (first?.type === 'paragraph') {
    ;({ content, colors } = normalizeEmpty(phrasingToInline(first.children)))
    rest = rest.slice(1)
  } else if (first?.type === 'html' && parseBlockColorComment(first.value)) {
    colors = parseBlockColorComment(first.value) ?? {}
    rest = rest.slice(1)
  }
  const children = parseFlow(rest)
  if (typeof item.checked === 'boolean') {
    return { type: 'checkListItem', props: { checked: item.checked, ...colors }, content, children }
  }
  if (list.ordered) {
    const start = index === 0 && list.start != null && list.start !== 1 ? list.start : undefined
    return {
      type: 'numberedListItem',
      props: { ...(start !== undefined ? { start } : {}), ...colors },
      content,
      children
    }
  }
  return { type: 'bulletListItem', props: { ...colors }, content, children }
}

function parseBlockquote(node: Blockquote): Block {
  const [first, ...rest] = node.children
  if (first?.type === 'paragraph') {
    const lead = first.children[0]
    if (lead?.type === 'text') {
      const marker = CALLOUT_MARKER.exec(lead.value)
      if (marker) {
        const remaining = lead.value.slice(marker[0].length)
        const phrasing: PhrasingContent[] = [
          ...(remaining ? [{ type: 'text' as const, value: remaining }] : []),
          ...first.children.slice(1)
        ]
        const { content } = phrasingToInline(phrasing)
        const colors: BlockColors = {}
        for (const token of marker[1].split(':').filter(Boolean)) {
          if (token.endsWith('_bg')) colors.backgroundColor = token.slice(0, -3)
          else colors.textColor = token
        }
        return {
          type: 'callout',
          props: { icon: marker[2].trim(), ...colors },
          content,
          children: parseFlow(rest)
        }
      }
    }
    const { content, colors } = normalizeEmpty(phrasingToInline(first.children))
    return { type: 'quote', props: { ...colors }, content, children: parseFlow(rest) }
  }
  return { type: 'quote', props: {}, content: [], children: parseFlow(node.children) }
}

function parseTable(node: Table): Block {
  const width = Math.max(...node.children.map((r) => r.children.length))
  const content: TableContent = {
    type: 'tableContent',
    rows: node.children.map((row) => ({
      cells: Array.from({ length: width }, (_, c) => {
        const cell = row.children[c]
        return cell ? phrasingToInline(cell.children).content : []
      })
    }))
  }
  return { type: 'table', props: {}, content, children: [] }
}
````

`src/shared/core/serialize.ts`:

````ts
import type { BlockContent, List, ListItem, PhrasingContent, RootContent, TableRow } from 'mdast'
import {
  DEFAULT_CALLOUT_BACKGROUND,
  type Block,
  type BlockColors,
  type Inline,
  type TableCell,
  type TableContent
} from './blocks'
import { isColor, renderAttrs } from './html'
import { inlineToPhrasing } from './inline'
import { stringifyMarkdown, stringifyPhrasing } from './processor'

export function blocksToMarkdown(blocks: Block[]): string {
  const trimmed = [...blocks]
  while (trimmed.length && isEmptyParagraph(trimmed[trimmed.length - 1])) trimmed.pop()
  if (trimmed.length === 0) return ''
  return stringifyMarkdown(blocksToFlow(trimmed))
}

function isEmptyParagraph(block: Block): boolean {
  return (
    block.type === 'paragraph' &&
    block.content.length === 0 &&
    block.children.length === 0 &&
    !isColor(block.props.textColor) &&
    !isColor(block.props.backgroundColor)
  )
}

const html = (value: string): RootContent => ({ type: 'html', value })
const colorsOf = (props: BlockColors): BlockColors => ({
  textColor: props.textColor,
  backgroundColor: props.backgroundColor
})

function blocksToFlow(blocks: Block[]): RootContent[] {
  const out: RootContent[] = []
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    if (block.type === 'bulletListItem' || block.type === 'checkListItem') {
      const items: Block[] = []
      while (
        i < blocks.length &&
        (blocks[i].type === 'bulletListItem' || blocks[i].type === 'checkListItem')
      ) {
        items.push(blocks[i++])
      }
      out.push(listNode(items, false))
      continue
    }
    if (block.type === 'numberedListItem') {
      const items: Block[] = [blocks[i++]]
      while (
        i < blocks.length &&
        blocks[i].type === 'numberedListItem' &&
        (blocks[i].props as { start?: number }).start === undefined
      ) {
        items.push(blocks[i++])
      }
      out.push(listNode(items, true))
      continue
    }
    out.push(...blockToFlow(block))
    i++
  }
  return out
}

function listNode(items: Block[], ordered: boolean): List {
  const children = items.map(listItemNode)
  const first = items[0].props as { start?: number }
  return {
    type: 'list',
    ordered,
    start: ordered ? (first.start ?? 1) : undefined,
    spread: children.some((c) => c.spread),
    children
  }
}

function listItemNode(block: Block): ListItem {
  const content =
    'content' in block && Array.isArray(block.content) ? (block.content as Inline[]) : []
  const colors = colorsOf(block.props as BlockColors)
  const phrasing = inlineToPhrasing(content, { blockColors: colors })
  // GFM only recognises `- [ ]` when the item has text, so empty to-dos get a placeholder.
  if (block.type === 'checkListItem' && content.length === 0)
    phrasing.unshift({ type: 'html', value: '&nbsp;' })
  const nested = blocksToFlow(block.children) as BlockContent[]
  const spread = block.children.some(
    (c) =>
      c.type !== 'bulletListItem' && c.type !== 'checkListItem' && c.type !== 'numberedListItem'
  )
  return {
    type: 'listItem',
    spread,
    checked: block.type === 'checkListItem' ? block.props.checked : null,
    children: [
      ...(phrasing.length ? [{ type: 'paragraph' as const, children: phrasing }] : []),
      ...nested
    ]
  }
}

function paragraphOf(content: Inline[], colors: BlockColors): RootContent {
  const phrasing = inlineToPhrasing(content, { blockColors: colors })
  if (content.length === 0) phrasing.unshift({ type: 'html', value: '&nbsp;' })
  return { type: 'paragraph', children: phrasing }
}

function childrenContainer(children: Block[]): RootContent[] {
  if (children.length === 0) return []
  return [html('<div data-children>'), ...blocksToFlow(children), html('</div>')]
}

function blockToFlow(block: Block): RootContent[] {
  switch (block.type) {
    case 'paragraph':
      return [
        paragraphOf(block.content, colorsOf(block.props)),
        ...childrenContainer(block.children)
      ]
    case 'heading': {
      if (block.props.isToggleable)
        return detailsFlow(block.content, colorsOf(block.props), block.children, block.props.level)
      const depth = Math.min(Math.max(block.props.level, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6
      return [
        {
          type: 'heading',
          depth,
          children: inlineToPhrasing(block.content, { blockColors: colorsOf(block.props) })
        },
        ...childrenContainer(block.children)
      ]
    }
    case 'toggleListItem':
      return detailsFlow(block.content, colorsOf(block.props), block.children)
    case 'quote': {
      const lead =
        block.content.length || block.children.length
          ? [paragraphOf(block.content, colorsOf(block.props))]
          : []
      return [
        {
          type: 'blockquote',
          children: [...lead, ...blocksToFlow(block.children)] as BlockContent[]
        }
      ]
    }
    case 'callout': {
      const tokens: string[] = []
      if (isColor(block.props.textColor)) tokens.push(block.props.textColor)
      const bg = block.props.backgroundColor ?? DEFAULT_CALLOUT_BACKGROUND
      if (bg !== DEFAULT_CALLOUT_BACKGROUND) tokens.push(`${bg || 'default'}_bg`)
      const marker = `[!callout${tokens.map((t) => `:${t}`).join('')}]${block.props.icon ? ` ${block.props.icon}` : ''}`
      const phrasing = inlineToPhrasing(block.content)
      const lead: PhrasingContent[] = [
        { type: 'html', value: phrasing.length ? `${marker}\n` : marker },
        ...phrasing
      ]
      return [
        {
          type: 'blockquote',
          children: [
            { type: 'paragraph', children: lead },
            ...blocksToFlow(block.children)
          ] as BlockContent[]
        }
      ]
    }
    case 'codeBlock': {
      const value = block.content.map((c) => c.text).join('')
      const lang =
        block.props.language && block.props.language !== 'text' ? block.props.language : null
      return [{ type: 'code', lang, value }, ...childrenContainer(block.children)]
    }
    case 'math':
      return [{ type: 'math', value: block.props.latex }, ...childrenContainer(block.children)]
    case 'divider':
      return [{ type: 'thematicBreak' }, ...childrenContainer(block.children)]
    case 'table':
      return [tableNode(block.content), ...childrenContainer(block.children)]
    case 'image': {
      const { url, caption, previewWidth } = block.props
      const node: RootContent = previewWidth
        ? html(`<img${renderAttrs({ src: url, alt: caption || undefined, width: previewWidth })}>`)
        : { type: 'paragraph', children: [{ type: 'image', url, alt: caption || null }] }
      return [node, ...childrenContainer(block.children)]
    }
    case 'video':
    case 'audio': {
      const attrs = renderAttrs({
        src: block.props.url,
        'data-caption': block.props.caption || undefined,
        controls: true
      })
      return [html(`<${block.type}${attrs}></${block.type}>`), ...childrenContainer(block.children)]
    }
    case 'file': {
      const name =
        block.props.name || decodeURIComponent(block.props.url.split('/').pop() ?? 'file')
      return [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: block.props.url,
              title: 'file',
              children: [{ type: 'text', value: name }]
            }
          ]
        },
        ...childrenContainer(block.children)
      ]
    }
    case 'pageLink':
      return [
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: block.props.href,
              title: 'page',
              children: [{ type: 'text', value: pageLabel(block.props.href) }]
            }
          ]
        }
      ]
    case 'raw':
      return [html(block.props.markdown), ...childrenContainer(block.children)]
    case 'columnList':
      return [
        html('<div data-columns>'),
        ...block.children.flatMap((col) => blockToFlow(col)),
        html('</div>')
      ]
    case 'column': {
      const width = block.props.width
      const open =
        width === undefined || width === 1
          ? '<div data-column>'
          : `<div data-column data-width="${width}">`
      return [html(open), ...blocksToFlow(block.children), html('</div>')]
    }
    case 'bulletListItem':
    case 'numberedListItem':
    case 'checkListItem':
      return [listNode([block], block.type === 'numberedListItem')]
  }
}

function detailsFlow(
  content: Inline[],
  colors: BlockColors,
  children: Block[],
  heading?: number
): RootContent[] {
  const summary = stringifyPhrasing(inlineToPhrasing(content, { blockColors: colors }))
  const open = heading ? `<details data-heading="${heading}">` : '<details>'
  return [
    html(`${open}\n<summary>${summary}</summary>`),
    ...blocksToFlow(children),
    html('</details>')
  ]
}

function pageLabel(href: string): string {
  const file = href.split('/').pop() ?? href
  return decodeURIComponent(file).replace(/\.md$/i, '')
}

function tableNode(content: TableContent): RootContent {
  const rows: TableRow[] = content.rows.map((row) => ({
    type: 'tableRow',
    children: row.cells.map((cell) => ({
      type: 'tableCell',
      children: inlineToPhrasing(cellContent(cell), { newlineAsHtml: true })
    }))
  }))
  return { type: 'table', align: rows[0]?.children.map(() => null) ?? [], children: rows }
}

function cellContent(cell: Inline[] | TableCell): Inline[] {
  return Array.isArray(cell) ? cell : cell.content
}
````

`src/shared/core/normalize.ts`:

````ts
import { DEFAULT_CALLOUT_BACKGROUND, type Block, type Inline, type StyledText } from './blocks'
import { isColor } from './html'
import { cleanStyles, sameStyles } from './inline'

// Reduces editor-shaped blocks (ids, default props, TableCell objects) to the
// minimal form markdownToBlocks produces, so documents can be compared.
export function normalizeBlocks(blocks: Block[]): Block[] {
  const out = blocks.map(normalizeBlock)
  while (out.length) {
    const last = out[out.length - 1]
    const empty =
      last.type === 'paragraph' &&
      last.content.length === 0 &&
      last.children.length === 0 &&
      Object.keys(last.props).length === 0
    if (!empty) break
    out.pop()
  }
  return out
}

const KEEP_PROPS: Record<string, string[]> = {
  paragraph: ['textColor', 'backgroundColor'],
  heading: ['level', 'isToggleable', 'textColor', 'backgroundColor'],
  bulletListItem: ['textColor', 'backgroundColor'],
  numberedListItem: ['start', 'textColor', 'backgroundColor'],
  checkListItem: ['checked', 'textColor', 'backgroundColor'],
  toggleListItem: ['textColor', 'backgroundColor'],
  quote: ['textColor', 'backgroundColor'],
  callout: ['icon', 'textColor', 'backgroundColor'],
  codeBlock: ['language'],
  table: [],
  divider: [],
  image: ['url', 'caption', 'previewWidth'],
  video: ['url', 'caption'],
  audio: ['url', 'caption'],
  file: ['url', 'name'],
  math: ['latex'],
  pageLink: ['href'],
  raw: ['markdown'],
  columnList: [],
  column: ['width']
}

function normalizeBlock(block: Block): Block {
  const props: Record<string, unknown> = {}
  for (const key of KEEP_PROPS[block.type] ?? []) {
    const value = (block.props as Record<string, unknown>)[key]
    if (value === undefined || value === null) continue
    if ((key === 'textColor' || key === 'backgroundColor') && !isColor(value as string)) {
      if (!(block.type === 'callout' && key === 'backgroundColor')) continue
    }
    if (
      block.type === 'callout' &&
      key === 'backgroundColor' &&
      value === DEFAULT_CALLOUT_BACKGROUND
    )
      continue
    if (key === 'isToggleable' && value !== true) continue
    if (key === 'start' && value === 1) continue
    if (key === 'caption' && value === '') continue
    props[key] = value
  }
  const base = { type: block.type, props, children: block.children.map(normalizeBlock) }
  if (block.type === 'table') {
    return {
      ...base,
      content: {
        type: 'tableContent',
        rows: block.content.rows.map((r) => ({
          cells: r.cells.map((c) => normalizeInline(Array.isArray(c) ? c : c.content))
        }))
      }
    } as Block
  }
  if (block.type === 'codeBlock') {
    const text = block.content.map((c) => c.text).join('')
    return { ...base, content: text ? [{ type: 'text', text, styles: {} }] : [] } as Block
  }
  if ('content' in block && Array.isArray(block.content)) {
    return { ...base, content: normalizeInline(block.content as Inline[]) } as Block
  }
  return base as Block
}

export function normalizeInline(content: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const item of content) {
    if (item.type === 'text') {
      if (item.text === '') continue
      const styles = cleanStyles(item.styles)
      const last = out[out.length - 1]
      if (last?.type === 'text' && sameStyles(last.styles, styles)) last.text += item.text
      else out.push({ type: 'text', text: item.text, styles })
    } else if (item.type === 'link') {
      out.push({
        type: 'link',
        href: item.href,
        content: normalizeInline(item.content) as StyledText[]
      })
    } else {
      out.push({ type: 'inlineMath', props: { latex: item.props.latex } })
    }
  }
  return out
}
````

Two `<img` matches inside `parse.ts` and `serialize.ts` are regexes and template strings for the Markdown dialect, not rendered images; ignore any design-lint warning about them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/shared/core/convert.test.ts`
Expected: PASS, 42 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm typecheck && pnpm lint`
Expected: no output from either.

- [ ] **Step 6: Commit (ask Dale first)**

```bash
git add src/shared/core
git commit -m "Add Markdown to BlockNote block converter"
```

### Task 3: Page files, paths and internal links

Frontmatter handling, filename-safe titles, relative href math, and the link mapper the workspace uses to translate between disk links and editor links.

**Files:**
- Create: `src/shared/core/paths.ts`, `src/shared/core/links.ts`, `src/shared/core/page.ts`
- Test: `src/shared/core/paths.test.ts`

**Interfaces:**
- Consumes: `Block`, `Inline` (Task 2), `markdownToBlocks`, `blocksToMarkdown` (Task 2).
- Produces:
  - `sanitizeTitle(title: string): string`, `stemOf(path)`, `dirOf(path)`, `joinPath(...parts)`, `normalizePath(path)`, `childDirOf(pagePath)`, `isExternalHref(href)`, `encodeHref(path)`, `decodeHref(href)`, `resolveHref(fromFile, href)`, `relativeHref(fromFile, target)` (from `paths.ts`).
  - `PAGE_LINK_PREFIX = 'nobsidian://page/'`, `pageLinkHref(id)`, `pageIdFromHref(href): string | null`, `mapBlockLinks(blocks, map: (href) => string): Block[]` (from `links.ts`).
  - `interface PageMeta { id?, title?, icon?, cover?, coverPosition?, fullWidth?, extra: Record<string, unknown> }`, `splitFrontmatter(text)`, `metaFromData(data)`, `parsePage(text): { meta, blocks }`, `serializePage(meta, blocks): string` (from `page.ts`).

- [ ] **Step 1: Write the failing test**


`src/shared/core/paths.test.ts`:

````ts
import { describe, expect, it } from 'vitest'
import { relativeHref, resolveHref, sanitizeTitle, encodeHref, isExternalHref } from './paths'
import { parsePage, serializePage } from './page'

describe('paths', () => {
  it('sanitizes titles for filenames', () => {
    expect(sanitizeTitle('A/B: C?')).toBe('A-B- C-')
    expect(sanitizeTitle('.hidden')).toBe('-hidden')
    expect(sanitizeTitle('   ')).toBe('Untitled')
    expect(sanitizeTitle('a\\b')).toBe('a-b')
    expect(sanitizeTitle('🚀 Launch')).toBe('🚀 Launch')
  })

  it('resolves and relativizes hrefs', () => {
    expect(resolveHref('Projects/Plan.md', '../attachments/a%20b.png')).toBe('attachments/a b.png')
    expect(resolveHref('Plan.md', 'Plan/Child.md')).toBe('Plan/Child.md')
    expect(relativeHref('Projects/Plan.md', 'attachments/a b.png')).toBe('../attachments/a%20b.png')
    expect(relativeHref('Projects.md', 'Projects/Web.md')).toBe('Projects/Web.md')
    expect(relativeHref('A/B/C.md', 'A/D.md')).toBe('../D.md')
    expect(encodeHref('My Notes/🚀.md')).toBe('My%20Notes/%F0%9F%9A%80.md')
  })

  it('detects external hrefs', () => {
    expect(isExternalHref('https://x.dev')).toBe(true)
    expect(isExternalHref('mailto:a@b.c')).toBe(true)
    expect(isExternalHref('nobsidian://page/1')).toBe(true)
    expect(isExternalHref('#top')).toBe(true)
    expect(isExternalHref('Other.md')).toBe(false)
  })
})

describe('page files', () => {
  it('round-trips frontmatter and keeps unknown keys', () => {
    const text = '---\nid: abc\ntitle: A/B\nicon: 🚀\ntags:\n  - x\n---\n\nHello\n'
    const page = parsePage(text)
    expect(page.meta).toEqual({ id: 'abc', title: 'A/B', icon: '🚀', extra: { tags: ['x'] } })
    expect(serializePage(page.meta, page.blocks)).toBe(text)
  })

  it('keeps invalid frontmatter as body text', () => {
    const page = parsePage('---\nid: [oops\n---\nBody\n')
    expect(page.meta).toEqual({ extra: {} })
    expect(page.blocks.length).toBeGreaterThan(0)
  })

  it('reads files saved with Windows line endings', () => {
    const page = parsePage('---\r\nid: a\r\n---\r\n\r\nHi\r\n')
    expect(page.meta.id).toBe('a')
    expect(page.blocks).toEqual([
      {
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: 'Hi', styles: {} }],
        children: []
      }
    ])
  })

  it('handles files without frontmatter', () => {
    expect(parsePage('Just text\n').meta).toEqual({ extra: {} })
    expect(serializePage({ extra: {} }, [])).toBe('')
  })
})
````

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/shared/core/paths.test.ts`
Expected: FAIL with "Failed to resolve import ./paths".

- [ ] **Step 3: Write the implementation**


`src/shared/core/paths.ts`:

````ts
// Posix path helpers for workspace-relative paths ("Projects/Plan.md").
// No node:path so the renderer can use them too.

const FORBIDDEN = new Set([...'/\\:*?"<>|'])

export function sanitizeTitle(title: string): string {
  const cleaned = [...title]
    .map((c) => (FORBIDDEN.has(c) || c.charCodeAt(0) < 32 ? '-' : c))
    .join('')
    .replace(/^\.+/, '-')
    .trim()
  return cleaned === '' ? 'Untitled' : cleaned.slice(0, 200)
}

export function stemOf(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.md$/i, '')
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter((p) => p !== '').join('/'))
}

export function normalizePath(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** Folder holding a page's children: "Projects.md" -> "Projects". */
export function childDirOf(pagePath: string): string {
  return pagePath.replace(/\.md$/i, '')
}

export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')
}

export function encodeHref(path: string): string {
  return path
    .split('/')
    .map((seg) => (seg === '..' || seg === '.' ? seg : encodeURIComponent(seg)))
    .join('/')
}

export function decodeHref(href: string): string {
  const clean = href.split('#')[0].split('?')[0]
  try {
    return decodeURIComponent(clean)
  } catch {
    return clean
  }
}

/** Workspace-relative target of `href` written inside the file at `fromFile`. */
export function resolveHref(fromFile: string, href: string): string {
  const decoded = decodeHref(href)
  if (decoded.startsWith('/')) return normalizePath(decoded)
  return joinPath(dirOf(fromFile), decoded)
}

/** Href from the file at `fromFile` to the workspace path `target`. */
export function relativeHref(fromFile: string, target: string): string {
  const from = dirOf(fromFile).split('/').filter(Boolean)
  const to = target.split('/').filter(Boolean)
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  const up = from.slice(common).map(() => '..')
  return encodeHref([...up, ...to.slice(common)].join('/'))
}
````

`src/shared/core/links.ts`:

````ts
import type { Block, Inline } from './blocks'

export const PAGE_LINK_PREFIX = 'nobsidian://page/'

export function pageLinkHref(id: string): string {
  return PAGE_LINK_PREFIX + id
}

export function pageIdFromHref(href: string): string | null {
  return href.startsWith(PAGE_LINK_PREFIX) ? href.slice(PAGE_LINK_PREFIX.length) : null
}

/** Returns copies of `blocks` with every link target passed through `map`. */
export function mapBlockLinks(blocks: Block[], map: (href: string) => string): Block[] {
  return blocks.map((block) => mapBlock(block, map))
}

function mapBlock(block: Block, map: (href: string) => string): Block {
  const children = mapBlockLinks(block.children, map)
  switch (block.type) {
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
      return {
        ...block,
        props: { ...block.props, url: mapNonEmpty(block.props.url, map) },
        children
      } as Block
    case 'pageLink':
      return {
        ...block,
        props: { ...block.props, href: mapNonEmpty(block.props.href, map) },
        children
      }
    case 'table':
      return {
        ...block,
        content: {
          ...block.content,
          rows: block.content.rows.map((row) => ({
            cells: row.cells.map((cell) =>
              Array.isArray(cell)
                ? mapInline(cell, map)
                : { ...cell, content: mapInline(cell.content, map) }
            )
          }))
        },
        children
      }
    default:
      if ('content' in block && Array.isArray(block.content) && block.type !== 'codeBlock') {
        return { ...block, content: mapInline(block.content as Inline[], map), children } as Block
      }
      return { ...block, children } as Block
  }
}

function mapInline(content: Inline[], map: (href: string) => string): Inline[] {
  return content.map((item) =>
    item.type === 'link' ? { ...item, href: mapNonEmpty(item.href, map) } : item
  )
}

function mapNonEmpty(href: string, map: (href: string) => string): string {
  return href === '' ? href : map(href)
}
````

`src/shared/core/page.ts`:

````ts
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Block } from './blocks'
import { markdownToBlocks } from './parse'
import { blocksToMarkdown } from './serialize'

export interface PageMeta {
  id?: string
  title?: string
  icon?: string
  cover?: string
  coverPosition?: number
  fullWidth?: boolean
  /** Frontmatter keys Nobsidian does not know, written back untouched. */
  extra: Record<string, unknown>
}

export interface ParsedPage {
  meta: PageMeta
  blocks: Block[]
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const KNOWN_KEYS = ['id', 'title', 'icon', 'cover', 'coverPosition', 'fullWidth'] as const

export function splitFrontmatter(text: string): {
  data: Record<string, unknown> | null
  body: string
} {
  const m = FRONTMATTER.exec(text)
  if (!m) return { data: {}, body: text }
  try {
    const data = parseYaml(m[1]) ?? {}
    if (typeof data !== 'object' || Array.isArray(data)) return { data: null, body: text }
    return {
      data: data as Record<string, unknown>,
      body: text.slice(m[0].length).replace(/^\r?\n/, '')
    }
  } catch {
    // Invalid YAML: keep the whole text as body so nothing is lost.
    return { data: null, body: text }
  }
}

export function metaFromData(data: Record<string, unknown>): PageMeta {
  const meta: PageMeta = { extra: {} }
  for (const [key, value] of Object.entries(data)) {
    if (key === 'id' && typeof value === 'string') meta.id = value
    else if (key === 'title' && typeof value === 'string') meta.title = value
    else if (key === 'icon' && typeof value === 'string') meta.icon = value
    else if (key === 'cover' && typeof value === 'string') meta.cover = value
    else if (key === 'coverPosition' && typeof value === 'number') meta.coverPosition = value
    else if (key === 'fullWidth' && typeof value === 'boolean') meta.fullWidth = value
    else if (!(KNOWN_KEYS as readonly string[]).includes(key)) meta.extra[key] = value
  }
  return meta
}

export function parsePage(text: string): ParsedPage {
  const { data, body } = splitFrontmatter(text)
  return { meta: data ? metaFromData(data) : { extra: {} }, blocks: markdownToBlocks(body) }
}

export function serializePage(meta: PageMeta, blocks: Block[]): string {
  const data: Record<string, unknown> = {}
  if (meta.id) data.id = meta.id
  if (meta.title !== undefined) data.title = meta.title
  if (meta.icon) data.icon = meta.icon
  if (meta.cover) data.cover = meta.cover
  if (meta.cover && meta.coverPosition !== undefined) data.coverPosition = meta.coverPosition
  if (meta.fullWidth) data.fullWidth = true
  Object.assign(data, meta.extra)
  const body = blocksToMarkdown(blocks)
  const front = Object.keys(data).length ? `---\n${stringifyYaml(data)}---\n` : ''
  if (!front) return body
  return body ? `${front}\n${body}` : front
}
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/shared`
Expected: PASS, 49 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm typecheck && pnpm lint`
Expected: no output.

- [ ] **Step 6: Commit (ask Dale first)**

```bash
git add src/shared/core
git commit -m "Add page file format, path helpers and link mapping"
```

### Task 4: Workspace service

Everything that touches the notes folder: scanning, ids, reading and writing pages, creating, renaming, moving, ordering, favorites, trash and attachments.
All mutations run one at a time through an internal queue.

**Files:**
- Create: `src/shared/types.ts`, `src/main/workspace/fs-utils.ts`, `src/main/workspace/state.ts`, `src/main/workspace/workspace.ts`
- Test: `src/main/workspace/workspace.test.ts`

**Interfaces:**
- Consumes: everything in `src/shared/core` (Tasks 2-3).
- Produces:
  - `interface PageNode { id; title; icon?; path; children: PageNode[] }`, `interface PageDoc { id; title; path; meta: PageMeta; blocks: Block[] }`, `interface WorkspaceInfo { root; name }`, `interface PageMetaPatch { icon?: string | null; cover?: string | null; coverPosition?: number | null; fullWidth?: boolean }` (from `src/shared/types.ts`).
  - `class Workspace` with `static open(root): Promise<Workspace>` (rejects with "Folder not found" instead of creating a missing folder), `root`, `rescan()`, `tree(): PageNode[]`, `favorites(): string[]`, `readPage(id): Promise<PageDoc>`, `writePage(id, blocks): Promise<void>`, `updateMeta(id, patch): Promise<void>`, `createPage(parentId | null, index?): Promise<PageNode>`, `renamePage(id, title)`, `movePage(id, parentId | null, index)`, `trashPage(id)`, `setFavorite(id, favorite)`, `saveAttachment(name, data: Uint8Array): Promise<string>` (returns an internal `/attachments/...` href), `resolveAsset(internalHref): string | null`.
  - `writeFileAtomic(path, data)`, `exists(path)`, `uniqueName(dir, stem, ext, { allow?, reserved? })`, `removeDirIfEmpty(dir)` (from `fs-utils.ts`); `APP_DIR = '.nobsidian'`, `loadState`, `saveState` (from `state.ts`); `ATTACHMENTS_DIR = 'attachments'`.
- Behaviour contract: new pages have an empty title (file `Untitled.md`, frontmatter `title: ""`); `readPage` returns internal hrefs (`nobsidian://page/<id>`, `/attachments/...`); `writePage` converts them back to relative paths using the *current* location of every page.

- [ ] **Step 1: Write the failing test**


`src/main/workspace/workspace.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from './workspace'
import { pageLinkHref } from '../../shared/core/links'
import type { Block } from '../../shared/core/blocks'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nobsidian-ws-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const read = (rel: string): Promise<string> => readFile(join(root, rel), 'utf8')
const text = (t: string): Block => ({
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text: t, styles: {} }],
  children: []
})

describe('Workspace scanning', () => {
  it('builds a nested tree and assigns ids to files without one', async () => {
    await writeFile(join(root, 'Projects.md'), '# Projects\n')
    await mkdir(join(root, 'Projects'))
    await writeFile(join(root, 'Projects', 'Website.md'), 'Hello\n')
    await mkdir(join(root, 'Orphan Folder'))
    await writeFile(join(root, 'Orphan Folder', 'Child.md'), '')
    const ws = await Workspace.open(root)
    const tree = ws.tree()
    expect(tree.map((n) => n.title)).toEqual(['Orphan Folder', 'Projects'])
    expect(tree[1].children.map((n) => n.path)).toEqual(['Projects/Website.md'])
    expect(await read('Projects/Website.md')).toMatch(/^---\nid: [0-9a-f-]{36}\n---\n\nHello\n$/)
    expect(await read('Orphan Folder.md')).toMatch(/^---\nid: /)
  })

  it('refuses to open a folder that does not exist', async () => {
    await expect(Workspace.open(join(root, 'missing'))).rejects.toThrow('Folder not found')
    await expect(readdir(join(root, 'missing'))).rejects.toThrow()
  })

  it('ignores attachments and the app folder', async () => {
    await mkdir(join(root, 'attachments'))
    await writeFile(join(root, 'attachments', 'note.md'), 'not a page')
    await mkdir(join(root, '.nobsidian'))
    const ws = await Workspace.open(root)
    expect(ws.tree()).toEqual([])
  })

  it('gives duplicated ids a fresh one', async () => {
    const same = '---\nid: 11111111-1111-1111-1111-111111111111\n---\n'
    await writeFile(join(root, 'A.md'), same)
    await writeFile(join(root, 'B.md'), same)
    const ws = await Workspace.open(root)
    const ids = ws.tree().map((n) => n.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('Workspace page operations', () => {
  it('creates, writes and reads pages', async () => {
    const ws = await Workspace.open(root)
    const a = await ws.createPage(null)
    const b = await ws.createPage(null)
    expect([a.path, b.path]).toEqual(['Untitled.md', 'Untitled (2).md'])
    expect(await read('Untitled (2).md')).toContain('title: ""')
    await ws.writePage(a.id, [text('Body')])
    const doc = await ws.readPage(a.id)
    expect(doc.blocks).toEqual([text('Body')])
    expect(await read('Untitled.md')).toBe(`---\nid: ${a.id}\ntitle: ""\n---\n\nBody\n`)
  })

  it('renames a page with its children and rewrites links', async () => {
    const ws = await Workspace.open(root)
    const parent = await ws.createPage(null)
    const child = await ws.createPage(parent.id)
    const other = await ws.createPage(null)
    await ws.writePage(other.id, [
      { type: 'pageLink', props: { href: pageLinkHref(child.id) }, children: [] }
    ])
    expect(await read(other.path)).toContain('[Untitled](Untitled/Untitled.md "page")')
    await ws.renamePage(parent.id, 'Projects / 2026')
    expect(ws.tree()[0].path).toBe('Projects - 2026.md')
    expect(await read('Projects - 2026.md')).toContain('title: Projects / 2026')
    expect(await readdir(join(root, 'Projects - 2026'))).toEqual(['Untitled.md'])
    expect(await read(other.path)).toContain('(Projects%20-%202026/Untitled.md "page")')
    const doc = await ws.readPage(other.id)
    expect(doc.blocks[0]).toMatchObject({
      type: 'pageLink',
      props: { href: pageLinkHref(child.id) }
    })
  })

  it('moves a page and keeps its relative links working', async () => {
    const ws = await Workspace.open(root)
    const target = await ws.createPage(null)
    await ws.renamePage(target.id, 'Target')
    const mover = await ws.createPage(null)
    await ws.renamePage(mover.id, 'Mover')
    const asset = await ws.saveAttachment('cat photo.png', new Uint8Array([1, 2, 3]))
    expect(asset).toBe('/attachments/cat%20photo.png')
    await ws.writePage(mover.id, [
      { type: 'image', props: { url: asset, caption: '' }, children: [] },
      text('x')
    ])
    expect(await read('Mover.md')).toContain('![](attachments/cat%20photo.png)')
    await ws.movePage(mover.id, target.id, 0)
    expect(await read('Target/Mover.md')).toContain('![](../attachments/cat%20photo.png)')
    expect(ws.tree()[0].children.map((c) => c.title)).toEqual(['Mover'])
    await expect(readdir(join(root, 'Mover'))).rejects.toThrow()
  })

  it('never names a root page like the attachments folder', async () => {
    const ws = await Workspace.open(root)
    const p = await ws.createPage(null)
    await ws.renamePage(p.id, 'Attachments')
    expect(ws.tree()[0]).toMatchObject({ title: 'Attachments', path: 'Attachments (2).md' })
  })

  it('refuses to move a page into its own descendant', async () => {
    const ws = await Workspace.open(root)
    const a = await ws.createPage(null)
    const b = await ws.createPage(a.id)
    await expect(ws.movePage(a.id, b.id, 0)).rejects.toThrow('inside itself')
  })

  it('reorders siblings and persists the order', async () => {
    const ws = await Workspace.open(root)
    const a = await ws.createPage(null)
    const b = await ws.createPage(null)
    await ws.movePage(b.id, null, 0)
    expect(ws.tree().map((n) => n.id)).toEqual([b.id, a.id])
    const reopened = await Workspace.open(root)
    expect(reopened.tree().map((n) => n.id)).toEqual([b.id, a.id])
  })

  it('trashes a page with its children and keeps links serializable', async () => {
    const ws = await Workspace.open(root)
    const a = await ws.createPage(null)
    await ws.createPage(a.id)
    const keep = await ws.createPage(null)
    await ws.writePage(keep.id, [
      { type: 'pageLink', props: { href: pageLinkHref(a.id) }, children: [] }
    ])
    await ws.setFavorite(a.id, true)
    await ws.trashPage(a.id)
    expect(ws.tree().map((n) => n.id)).toEqual([keep.id])
    expect(ws.favorites()).toEqual([])
    const trash = await readdir(join(root, '.nobsidian', 'trash'))
    expect(trash).toHaveLength(1)
    expect((await readdir(join(root, '.nobsidian', 'trash', trash[0]))).sort()).toEqual([
      'Untitled',
      'Untitled.md',
      'meta.json'
    ])
    await ws.writePage(keep.id, (await ws.readPage(keep.id)).blocks)
    expect(await read(keep.path)).toContain('(Untitled.md "page")')
  })

  it('updates icon, cover and full width in frontmatter', async () => {
    const ws = await Workspace.open(root)
    const p = await ws.createPage(null)
    const cover = await ws.saveAttachment('cover.jpg', new Uint8Array([9]))
    await ws.updateMeta(p.id, { icon: '🚀', cover, coverPosition: 30, fullWidth: true })
    expect(await read(p.path)).toBe(
      `---\nid: ${p.id}\ntitle: ""\nicon: 🚀\ncover: attachments/cover.jpg\ncoverPosition: 30\nfullWidth: true\n---\n`
    )
    const doc = await ws.readPage(p.id)
    expect(doc.meta).toMatchObject({ icon: '🚀', cover: '/attachments/cover.jpg', fullWidth: true })
    expect(ws.tree()[0].icon).toBe('🚀')
  })

  it('serializes concurrent writes', async () => {
    const ws = await Workspace.open(root)
    const p = await ws.createPage(null)
    await Promise.all([
      ws.writePage(p.id, [text('one')]),
      ws.renamePage(p.id, 'Renamed'),
      ws.writePage(p.id, [text('two')])
    ])
    expect(await read('Renamed.md')).toBe(`---\nid: ${p.id}\n---\n\ntwo\n`)
  })

  it('refuses asset paths outside the workspace', async () => {
    const ws = await Workspace.open(root)
    expect(ws.resolveAsset('/../../etc/passwd')).toBe(join(root, 'etc', 'passwd'))
    expect(ws.resolveAsset('/.nobsidian/workspace.json')).toBeNull()
  })
})
````

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/main/workspace`
Expected: FAIL with "Failed to resolve import ./workspace".

- [ ] **Step 3: Write the implementation**


`src/shared/types.ts`:

````ts
import type { Block } from './core/blocks'
import type { PageMeta } from './core/page'

export interface WorkspaceInfo {
  root: string
  name: string
}

export interface PageNode {
  id: string
  title: string
  icon?: string
  /** Workspace-relative posix path of the page file, e.g. "Projects/Plan.md". */
  path: string
  children: PageNode[]
}

/** A page as the renderer sees it: links use internal hrefs (see core/links). */
export interface PageDoc {
  id: string
  title: string
  path: string
  meta: PageMeta
  blocks: Block[]
}

export interface PageMetaPatch {
  icon?: string | null
  cover?: string | null
  coverPosition?: number | null
  fullWidth?: boolean
}
````

`src/main/workspace/fs-utils.ts`:

````ts
import { open, rename, unlink, stat, readdir, rmdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * First of `stem`, `stem (2)`, `stem (3)`... whose `<stem><ext>` is free in `dir`.
 * `allow` is the caller's current name; `reserved` names count as taken.
 */
export async function uniqueName(
  dir: string,
  stem: string,
  ext: string,
  options: { allow?: string; reserved?: string[] } = {}
): Promise<string> {
  const reserved = new Set((options.reserved ?? []).map((r) => r.toLowerCase()))
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? stem : `${stem} (${n})`
    const lower = candidate.toLowerCase()
    if (reserved.has(lower)) continue
    // macOS volumes are usually case-insensitive, so a case-only rename must not collide with itself.
    if (options.allow !== undefined && lower === options.allow.toLowerCase()) return candidate
    const taken =
      (await exists(join(dir, candidate + ext))) ||
      (ext === '.md' && (await exists(join(dir, candidate))))
    if (!taken) return candidate
  }
}

export async function removeDirIfEmpty(dir: string): Promise<void> {
  try {
    if ((await readdir(dir)).length === 0) await rmdir(dir)
  } catch {
    // Missing or non-empty: nothing to do.
  }
}
````

`src/main/workspace/state.ts`:

````ts
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './fs-utils'

export const APP_DIR = '.nobsidian'
export const ROOT_ORDER_KEY = 'root'

export interface WorkspaceState {
  version: 1
  /** Parent page id (or "root") -> ordered child page ids. */
  order: Record<string, string[]>
  favorites: string[]
}

const empty = (): WorkspaceState => ({ version: 1, order: {}, favorites: [] })

export async function loadState(root: string): Promise<WorkspaceState> {
  try {
    const raw = JSON.parse(await readFile(join(root, APP_DIR, 'workspace.json'), 'utf8'))
    return {
      version: 1,
      order: typeof raw.order === 'object' && raw.order ? raw.order : {},
      favorites: Array.isArray(raw.favorites) ? raw.favorites : []
    }
  } catch {
    return empty()
  }
}

export async function saveState(root: string, state: WorkspaceState): Promise<void> {
  await mkdir(join(root, APP_DIR), { recursive: true })
  await writeFileAtomic(
    join(root, APP_DIR, 'workspace.json'),
    JSON.stringify(state, null, 2) + '\n'
  )
}
````

`src/main/workspace/workspace.ts`:

````ts
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import type { Block } from '../../shared/core/blocks'
import { mapBlockLinks, pageIdFromHref, pageLinkHref } from '../../shared/core/links'
import {
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
import type { PageDoc, PageMetaPatch, PageNode } from '../../shared/types'
import { exists, removeDirIfEmpty, uniqueName, writeFileAtomic } from './fs-utils'
import { APP_DIR, ROOT_ORDER_KEY, loadState, saveState, type WorkspaceState } from './state'

export const ATTACHMENTS_DIR = 'attachments'

interface PageRecord {
  id: string
  title: string
  icon?: string
  path: string
  parentId: string | null
}

export class Workspace {
  private pages = new Map<string, PageRecord>()
  /** Last known path of every id ever seen, so links to trashed pages still serialize. */
  private knownPaths = new Map<string, string>()
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(
    readonly root: string,
    private state: WorkspaceState
  ) {}

  static async open(root: string): Promise<Workspace> {
    // Never recreate a missing folder: it may be on an unmounted drive or have been moved.
    const info = await stat(root).catch(() => null)
    if (!info?.isDirectory()) throw new Error(`Folder not found: ${root}`)
    const ws = new Workspace(root, await loadState(root))
    await ws.scan()
    return ws
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

  // ---------- scanning ----------

  rescan(): Promise<void> {
    return this.run(() => this.scan())
  }

  private async scan(): Promise<void> {
    this.pages.clear()
    const seen = new Set<string>()
    await this.scanDir('', null, seen)
  }

  private async scanDir(dir: string, parentId: string | null, seen: Set<string>): Promise<void> {
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
      if (![...files].some((f) => f.slice(0, -3) === name)) {
        await writeFileAtomic(this.abs(joinPath(dir, `${name}.md`)), '')
        files.add(`${name}.md`)
      }
    }
    for (const file of [...files].sort()) {
      if (file.startsWith('.')) continue
      const path = joinPath(dir, file)
      const record = await this.loadRecord(path, parentId, seen)
      this.pages.set(record.id, record)
      this.knownPaths.set(record.id, record.path)
      await this.scanDir(childDirOf(path), record.id, seen)
    }
  }

  private async loadRecord(
    path: string,
    parentId: string | null,
    seen: Set<string>
  ): Promise<PageRecord> {
    const text = await readFile(this.abs(path), 'utf8')
    const { data, body } = splitFrontmatter(text)
    const meta = data ? metaFromData(data) : { extra: {} }
    let id = meta.id
    if (!id || seen.has(id)) {
      id = randomUUID()
      const blocks = parsePage(body).blocks
      await writeFileAtomic(this.abs(path), serializePage({ ...meta, id }, blocks))
    }
    seen.add(id)
    return { id, title: meta.title ?? stemOf(path), icon: meta.icon, path, parentId }
  }

  // ---------- queries ----------

  tree(): PageNode[] {
    const build = (parentId: string | null): PageNode[] =>
      this.childrenOf(parentId).map((r) => ({
        id: r.id,
        title: r.title,
        icon:
          r.icon && !r.icon.includes('/')
            ? r.icon
            : r.icon
              ? this.toInternalHref(r.path, r.icon)
              : undefined,
        path: r.path,
        children: build(r.id)
      }))
    return build(null)
  }

  favorites(): string[] {
    return this.state.favorites.filter((id) => this.pages.has(id))
  }

  private childrenOf(parentId: string | null): PageRecord[] {
    const kids = [...this.pages.values()].filter((r) => r.parentId === parentId)
    const order = this.state.order[parentId ?? ROOT_ORDER_KEY] ?? []
    const rank = (r: PageRecord): number => {
      const i = order.indexOf(r.id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return kids.sort(
      (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, undefined, { numeric: true })
    )
  }

  private record(id: string): PageRecord {
    const r = this.pages.get(id)
    if (!r) throw new Error(`Unknown page ${id}`)
    return r
  }

  private descendantsOf(id: string): PageRecord[] {
    const out: PageRecord[] = []
    for (const child of this.childrenOf(id)) out.push(child, ...this.descendantsOf(child.id))
    return out
  }

  // ---------- reading and writing ----------

  async readPage(id: string): Promise<PageDoc> {
    const r = this.record(id)
    const { meta, blocks } = parsePage(await readFile(this.abs(r.path), 'utf8'))
    return {
      id,
      title: r.title,
      path: r.path,
      meta: this.metaToInternal(r.path, meta),
      blocks: mapBlockLinks(blocks, (href) => this.toInternalHref(r.path, href))
    }
  }

  writePage(id: string, blocks: Block[]): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const { meta } = parsePage(await readFile(this.abs(r.path), 'utf8'))
      const fileBlocks = mapBlockLinks(blocks, (href) => this.toFileHref(r.path, href))
      await writeFileAtomic(this.abs(r.path), serializePage({ ...meta, id }, fileBlocks))
    })
  }

  updateMeta(id: string, patch: PageMetaPatch): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const { meta, blocks } = parsePage(await readFile(this.abs(r.path), 'utf8'))
      const next: PageMeta = { ...meta, id }
      if (patch.icon !== undefined)
        next.icon = patch.icon ? this.metaHrefToFile(r.path, patch.icon) : undefined
      if (patch.cover !== undefined)
        next.cover = patch.cover ? this.toFileHref(r.path, patch.cover) : undefined
      if (patch.coverPosition !== undefined) next.coverPosition = patch.coverPosition ?? undefined
      if (patch.fullWidth !== undefined) next.fullWidth = patch.fullWidth
      await writeFileAtomic(this.abs(r.path), serializePage(next, blocks))
      r.icon = next.icon
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
      await writeFileAtomic(this.abs(path), serializePage(meta, []))
      const record: PageRecord = { id, title, path, parentId }
      this.pages.set(id, record)
      this.knownPaths.set(id, path)
      this.insertOrder(parentId, id, index)
      await saveState(this.root, this.state)
      return { id, title, path, children: [] }
    })
  }

  renamePage(id: string, title: string): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const dir = dirOf(r.path)
      const stem = await this.pageStem(dir, title, stemOf(r.path))
      await this.relocate(r, dir, stem)
      r.title = title
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
      await saveState(this.root, this.state)
    })
  }

  trashPage(id: string): Promise<void> {
    return this.run(async () => {
      const r = this.record(id)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dest = join(this.root, APP_DIR, 'trash', `${stamp}-${id}`)
      await mkdir(dest, { recursive: true })
      const name = basename(r.path)
      await rename(this.abs(r.path), join(dest, name))
      const folder = this.abs(childDirOf(r.path))
      if (await exists(folder)) await rename(folder, join(dest, name.slice(0, -3)))
      await writeFile(
        join(dest, 'meta.json'),
        JSON.stringify(
          {
            id,
            title: r.title,
            originalPath: r.path,
            parentId: r.parentId,
            deletedAt: new Date().toISOString()
          },
          null,
          2
        )
      )
      for (const d of [r, ...this.descendantsOf(id)]) this.pages.delete(d.id)
      this.removeOrder(r.parentId, id)
      this.state.favorites = this.state.favorites.filter((f) => this.pages.has(f))
      await removeDirIfEmpty(this.abs(dirOf(r.path)))
      await saveState(this.root, this.state)
    })
  }

  setFavorite(id: string, favorite: boolean): Promise<void> {
    return this.run(async () => {
      this.record(id)
      const rest = this.state.favorites.filter((f) => f !== id)
      this.state.favorites = favorite ? [...rest, id] : rest
      await saveState(this.root, this.state)
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
    const { meta, blocks } = parsePage(await readFile(this.abs(r.path), 'utf8'))
    const title = stemOf(r.path) === r.title ? undefined : r.title
    if (meta.title === title) return
    await writeFileAtomic(this.abs(r.path), serializePage({ ...meta, id: r.id, title }, blocks))
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
      rec.path = moved.get(rec.path) ?? rec.path
      this.knownPaths.set(rec.id, rec.path)
    }
    await this.rewriteLinks(moved, [stemOf(oldPath)])
  }

  private async rewriteLinks(moved: Map<string, string>, tokens: string[]): Promise<void> {
    const newToOld = new Map([...moved].map(([o, n]) => [n, o]))
    const needles = tokens.flatMap((t) => [t, encodeURIComponent(t)])
    for (const rec of this.pages.values()) {
      const oldFile = newToOld.get(rec.path) ?? rec.path
      const text = await readFile(this.abs(rec.path), 'utf8')
      if (!newToOld.has(rec.path) && !needles.some((n) => text.includes(n))) continue
      const { meta, blocks } = parsePage(text)
      let changed = false
      const remap = (href: string): string => {
        if (isExternalHref(href)) return href
        const target = resolveHref(oldFile, href)
        const next = relativeHref(rec.path, moved.get(target) ?? target)
        if (decodeHref(next) === decodeHref(href)) return href
        changed = true
        return next
      }
      const nextBlocks = mapBlockLinks(blocks, remap)
      const nextMeta = { ...meta }
      if (meta.cover) nextMeta.cover = remap(meta.cover)
      if (meta.icon?.includes('/')) nextMeta.icon = remap(meta.icon)
      if (changed) await writeFileAtomic(this.abs(rec.path), serializePage(nextMeta, nextBlocks))
    }
  }

  // ---------- href translation between disk and editor ----------

  private toInternalHref(pagePath: string, href: string): string {
    if (isExternalHref(href)) return href
    const target = resolveHref(pagePath, href)
    for (const r of this.pages.values()) if (r.path === target) return pageLinkHref(r.id)
    return '/' + encodeHref(target)
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

  private metaToInternal(pagePath: string, meta: PageMeta): PageMeta {
    return {
      ...meta,
      icon: meta.icon?.includes('/') ? this.toInternalHref(pagePath, meta.icon) : meta.icon,
      cover: meta.cover ? this.toInternalHref(pagePath, meta.cover) : undefined
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
````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS, 63 tests (49 shared + 14 workspace).

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm typecheck && pnpm lint`
Expected: no output.

- [ ] **Step 6: Commit (ask Dale first)**

```bash
git add src/shared/types.ts src/main/workspace
git commit -m "Add workspace service for pages on disk"
```

### Task 5: Main process, IPC and settings

The real main process: window with a hidden inset title bar, typed IPC handlers for every workspace operation, the app menu and shortcuts, per-machine settings, the `nbfile:` protocol that serves workspace images safely, and flush-before-quit.

**Files:**
- Create: `src/shared/ipc.ts`, `src/main/settings.ts`, `src/main/ipc.ts`, `src/main/handlers.ts`, `src/main/menu.ts`, `src/preload/index.d.ts`
- Replace: `src/main/index.ts`, `src/preload/index.ts`
- Test: `src/main/settings.test.ts`

**Interfaces:**
- Consumes: `Workspace` (Task 4), shared types.
- Produces:
  - `IpcContract` channels: `workspace:current`, `workspace:choose`, `tree:get`, `page:read`, `page:write`, `page:meta`, `page:create`, `page:rename`, `page:move`, `page:trash`, `page:favorite`, `attachment:save`, `attachment:chooseImage`, `attachment:open`, `settings:get`, `settings:set`, `shell:openExternal`, `app:flushed`.
  - Events: `tree:changed` (`TreeSnapshot { pages, favorites }`, sent after every structural change), `menu:command` (`'new-page' | 'toggle-sidebar' | 'toggle-theme' | 'back' | 'forward'`), `app:flush` (renderer must write pending edits, then invoke `app:flushed`).
  - `window.api: Api` with `invoke(channel, payload)` and `on(event, listener) => unsubscribe`.
  - `interface Settings { lastWorkspace?, theme: 'system' | 'light' | 'dark', sidebarWidth, sidebarCollapsed, expanded: Record<root, id[]>, lastPage: Record<root, id>, windowBounds? }`, `DEFAULT_SETTINGS`, `class SettingsStore { load(), get(), set(patch) }`.
  - `ASSET_SCHEME = 'nbfile'`; `nbfile://workspace/<internal path>` serves a workspace file, refusing `.nobsidian/`.

- [ ] **Step 1: Write the failing test**


`src/main/settings.test.ts`:

````ts
import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, SettingsStore } from './settings'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nobsidian-settings-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

it('starts from defaults and persists patches', async () => {
  const file = join(dir, 'nested', 'settings.json')
  const store = new SettingsStore(file)
  expect(await store.load()).toEqual(DEFAULT_SETTINGS)
  await store.set({ theme: 'dark', lastWorkspace: '/tmp/notes' })
  const reloaded = new SettingsStore(file)
  expect(await reloaded.load()).toEqual({
    ...DEFAULT_SETTINGS,
    theme: 'dark',
    lastWorkspace: '/tmp/notes'
  })
  expect(JSON.parse(await readFile(file, 'utf8')).theme).toBe('dark')
})

it('falls back to defaults when the file is corrupt', async () => {
  const file = join(dir, 'settings.json')
  await writeFile(file, '{nope')
  expect(await new SettingsStore(file).load()).toEqual(DEFAULT_SETTINGS)
})
````

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/main/settings.test.ts`
Expected: FAIL with "Failed to resolve import ./settings".

- [ ] **Step 3: Write the implementation**


`src/shared/ipc.ts`:

````ts
import type { Block } from './core/blocks'
import type { PageDoc, PageMetaPatch, PageNode, WorkspaceInfo } from './types'

export type ThemePreference = 'system' | 'light' | 'dark'

/** Per-machine UI state, stored in Electron's userData folder. */
export interface Settings {
  lastWorkspace?: string
  theme: ThemePreference
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** Workspace root -> ids of expanded sidebar rows. */
  expanded: Record<string, string[]>
  /** Workspace root -> id of the page open when the app last closed. */
  lastPage: Record<string, string>
  windowBounds?: { x: number; y: number; width: number; height: number }
}

export interface TreeSnapshot {
  pages: PageNode[]
  favorites: string[]
}

export type MenuCommand = 'new-page' | 'toggle-sidebar' | 'toggle-theme' | 'back' | 'forward'

export interface IpcContract {
  'workspace:current': [payload: void, result: WorkspaceInfo | null]
  'workspace:choose': [payload: void, result: WorkspaceInfo | null]
  'tree:get': [payload: void, result: TreeSnapshot]
  'page:read': [payload: { id: string }, result: PageDoc]
  'page:write': [payload: { id: string; blocks: Block[] }, result: void]
  'page:meta': [payload: { id: string; patch: PageMetaPatch }, result: void]
  'page:create': [payload: { parentId: string | null; index?: number }, result: PageNode]
  'page:rename': [payload: { id: string; title: string }, result: void]
  'page:move': [payload: { id: string; parentId: string | null; index: number }, result: void]
  'page:trash': [payload: { id: string }, result: void]
  'page:favorite': [payload: { id: string; favorite: boolean }, result: void]
  'attachment:save': [payload: { name: string; data: Uint8Array }, result: string]
  'attachment:chooseImage': [payload: void, result: string | null]
  'attachment:open': [payload: { href: string }, result: void]
  'settings:get': [payload: void, result: Settings]
  'settings:set': [payload: Partial<Settings>, result: Settings]
  'shell:openExternal': [payload: { url: string }, result: void]
  'app:flushed': [payload: void, result: void]
}

export type IpcChannel = keyof IpcContract
export type IpcPayload<C extends IpcChannel> = IpcContract[C][0]
export type IpcResult<C extends IpcChannel> = IpcContract[C][1]

export interface IpcEvents {
  'tree:changed': TreeSnapshot
  'menu:command': MenuCommand
  'app:flush': void
}

export interface Api {
  invoke<C extends IpcChannel>(channel: C, payload: IpcPayload<C>): Promise<IpcResult<C>>
  on<E extends keyof IpcEvents>(event: E, listener: (data: IpcEvents[E]) => void): () => void
}

export const ASSET_SCHEME = 'nbfile'
````

`src/main/settings.ts`:

````ts
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Settings } from '../shared/ipc'
import { writeFileAtomic } from './workspace/fs-utils'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  sidebarWidth: 240,
  sidebarCollapsed: false,
  expanded: {},
  lastPage: {}
}

export class SettingsStore {
  private current: Settings = { ...DEFAULT_SETTINGS }

  constructor(private readonly file: string) {}

  async load(): Promise<Settings> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<Settings>
      this.current = { ...DEFAULT_SETTINGS, ...raw }
    } catch {
      this.current = { ...DEFAULT_SETTINGS }
    }
    return this.current
  }

  get(): Settings {
    return this.current
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    this.current = { ...this.current, ...patch }
    await mkdir(dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify(this.current, null, 2) + '\n')
    return this.current
  }
}
````

`src/main/ipc.ts`:

````ts
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { IpcChannel, IpcEvents, IpcPayload, IpcResult } from '../shared/ipc'

export function handle<C extends IpcChannel>(
  channel: C,
  handler: (
    payload: IpcPayload<C>,
    event: IpcMainInvokeEvent
  ) => Promise<IpcResult<C>> | IpcResult<C>
): void {
  ipcMain.handle(channel, (event, payload: IpcPayload<C>) => handler(payload, event))
}

export function send<E extends keyof IpcEvents>(
  target: WebContents,
  event: E,
  data: IpcEvents[E]
): void {
  if (!target.isDestroyed()) target.send(event, data)
}
````

`src/main/handlers.ts`:

````ts
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
  handle('page:write', ({ id, blocks }) => ws().writePage(id, blocks))
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
````

`src/main/menu.ts`:

````ts
import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc'
import { send } from './ipc'

export function buildMenu(
  getWindow: () => BrowserWindow | null,
  chooseWorkspace: () => void
): Menu {
  const command = (cmd: MenuCommand) => (): void => {
    const win = getWindow()
    if (win) send(win.webContents, 'menu:command', cmd)
  }
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Page', accelerator: 'CmdOrCtrl+N', click: command('new-page') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: chooseWorkspace },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: command('toggle-sidebar') },
        {
          label: 'Toggle Dark Mode',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: command('toggle-theme')
        },
        { type: 'separator' },
        ...(app.isPackaged
          ? []
          : ([{ role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: command('back') },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: command('forward') }
      ]
    },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}
````

`src/main/index.ts`:

````ts
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  screen,
  shell,
  type Rectangle
} from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { ASSET_SCHEME } from '../shared/ipc'
import { openWorkspace, registerHandlers, type AppContext } from './handlers'
import { send } from './ipc'
import { buildMenu } from './menu'
import { SettingsStore } from './settings'

if (process.env.NOBSIDIAN_USER_DATA) app.setPath('userData', process.env.NOBSIDIAN_USER_DATA)

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

let mainWindow: BrowserWindow | null = null
let quitting = false
app.on('before-quit', () => {
  quitting = true
})
const ctx: AppContext = {
  settings: new SettingsStore(join(app.getPath('userData'), 'settings.json')),
  workspace: null,
  window: () => mainWindow
}

/** Saved bounds, unless the display they were on is gone. */
function restoredBounds(): Partial<Rectangle> {
  const saved = ctx.settings.get().windowBounds
  if (!saved) return { width: 1280, height: 820 }
  const area = screen.getDisplayMatching(saved).workArea
  const visible =
    saved.x < area.x + area.width &&
    saved.x + saved.width > area.x &&
    saved.y < area.y + area.height &&
    saved.y + saved.height > area.y
  return visible ? saved : { width: saved.width, height: saved.height }
}

function createWindow(): void {
  const win = new BrowserWindow({
    ...restoredBounds(),
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Nobsidian',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!(
      is.dev &&
      process.env.ELECTRON_RENDERER_URL &&
      url.startsWith(process.env.ELECTRON_RENDERER_URL)
    )) {
      event.preventDefault()
    }
  })

  // Give the renderer a moment to write pending edits before the window goes away.
  // Cancelling the close also cancels an app quit, so the quit is re-issued afterwards.
  let flushed = false
  win.on('close', (event) => {
    if (flushed) return
    event.preventDefault()
    const saving = ctx.settings.set({ windowBounds: win.getNormalBounds() }).catch(() => {})
    const finish = (): void => {
      if (flushed) return
      flushed = true
      void saving.then(() => (quitting ? app.quit() : win.close()))
    }
    ipcMain.removeHandler('app:flushed')
    ipcMain.handle('app:flushed', () => finish())
    send(win.webContents, 'app:flush', undefined)
    setTimeout(finish, 2000)
  })
  win.on('closed', () => {
    mainWindow = null
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

async function chooseWorkspaceFromMenu(): Promise<void> {
  const win = mainWindow
  if (!win) return
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return
  await openWorkspace(ctx, result.filePaths[0])
  win.webContents.reload()
}

app.whenReady().then(async () => {
  const settings = await ctx.settings.load()
  if (settings.lastWorkspace) {
    try {
      await openWorkspace(ctx, settings.lastWorkspace)
    } catch {
      ctx.workspace = null
    }
  }

  protocol.handle(ASSET_SCHEME, (request) => {
    const url = new URL(request.url)
    const file = ctx.workspace?.resolveAsset(url.pathname)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  registerHandlers(ctx)
  Menu.setApplicationMenu(
    buildMenu(
      () => mainWindow,
      () => void chooseWorkspaceFromMenu()
    )
  )
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
````

`src/preload/index.ts`:

````ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, IpcEvents } from '../shared/ipc'

const api: Api = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (event, listener) => {
    const wrapped = (_e: IpcRendererEvent, data: IpcEvents[typeof event]): void => listener(data)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  }
}

contextBridge.exposeInMainWorld('api', api)
````

`src/preload/index.d.ts`:

````ts
import type { Api } from '../shared/ipc'

declare global {
  interface Window {
    api: Api
  }
}
````

- [ ] **Step 4: Run unit tests, checks and the smoke test**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm test:e2e`
Expected: 65 unit tests pass; no typecheck or lint output; the smoke test passes (the skeleton renderer still shows the "Nobsidian" heading and the window title is still "Nobsidian").

- [ ] **Step 5: Check that quitting exits**

The close handler cancels the first close to let the renderer flush, which on macOS also cancels an app quit; `before-quit` sets `quitting` so the quit is re-issued.
The smoke test's `app.close()` returning (instead of hanging for 30 s) proves this works.

- [ ] **Step 6: Commit (ask Dale first)**

```bash
git add src/shared/ipc.ts src/main src/preload
git commit -m "Add main process, IPC contract and settings"
```

### Task 6: Renderer foundation

The pieces every screen uses: Notion design tokens and layout CSS, the app store, tree helpers, theme handling, asset URLs, link routing, icons and a popover/menu primitive.

**Files:**
- Create: `src/renderer/src/styles/tokens.css`, `src/renderer/src/styles/app.css`, `src/renderer/src/store.ts`, `src/renderer/src/lib/tree.ts`, `src/renderer/src/lib/theme.ts`, `src/renderer/src/lib/assets.ts`, `src/renderer/src/lib/navigation.ts`, `src/renderer/src/components/icons.tsx`, `src/renderer/src/components/Popover.tsx`, `src/renderer/src/components/PageIconView.tsx`
- Test: `src/renderer/src/lib/tree.test.ts`

**Interfaces:**
- Consumes: `window.api` and shared types (Task 5).
- Produces:
  - `useApp` zustand store with state `ready, workspace, tree, favorites, settings, currentId, history, historyIndex, renamingId` and actions `init, chooseWorkspace, applySnapshot, openPage, back, forward, createPage(parentId, index?) => Promise<id>, renamePage, movePage, trashPage, toggleFavorite, updateSettings, setExpanded(id, open), setRenaming`; `registerFlusher(fn) => unregister`, `flushAll()`.
  - `findNode, pathTo, parentOf, siblingsOf, isDescendant, firstPageId, dropTarget(nodes, draggedId, targetId, 'before' | 'after' | 'inside')` (from `lib/tree.ts`).
  - `useEffectiveTheme(preference) => 'light' | 'dark'` (sets `<html data-theme>`), `toggledPreference(current)`; `resolveAssetUrl(href)`; `openHref(href)`.
  - `Popover({ anchor, align?, onClose, children, className? })`, `Menu({ anchor, align?, items, onClose })`, `PageIconView({ icon?, size? })`, icon components.
- Zustand selectors must return stable references (a fresh `[]` per call re-renders forever; use a module-level constant).

- [ ] **Step 1: Write the failing test**


`src/renderer/src/lib/tree.test.ts`:

````ts
import { describe, expect, it } from 'vitest'
import type { PageNode } from '@shared/types'
import { dropTarget, pathTo } from './tree'

const node = (id: string, children: PageNode[] = []): PageNode => ({
  id,
  title: id,
  path: `${id}.md`,
  children
})
const tree = [node('a', [node('a1'), node('a2')]), node('b'), node('c')]

describe('tree helpers', () => {
  it('finds the path to a node', () => {
    expect(pathTo(tree, 'a2').map((n) => n.id)).toEqual(['a', 'a2'])
    expect(pathTo(tree, 'zzz')).toEqual([])
  })

  it('computes drop targets', () => {
    expect(dropTarget(tree, 'c', 'a', 'before')).toEqual({ parentId: null, index: 0 })
    expect(dropTarget(tree, 'a', 'c', 'after')).toEqual({ parentId: null, index: 2 })
    expect(dropTarget(tree, 'b', 'a', 'inside')).toEqual({ parentId: 'a', index: 2 })
    expect(dropTarget(tree, 'a1', 'a2', 'after')).toEqual({ parentId: 'a', index: 1 })
  })

  it('refuses to drop a page into itself or its descendants', () => {
    expect(dropTarget(tree, 'a', 'a1', 'inside')).toBeNull()
    expect(dropTarget(tree, 'a', 'a', 'before')).toBeNull()
  })
})
````

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test src/renderer/src/lib/tree.test.ts`
Expected: FAIL with "Failed to resolve import ./tree".

- [ ] **Step 3: Write the implementation**


`src/renderer/src/styles/tokens.css`:

````css
/* Notion's palette and type scale. Light is the default; dark applies via data-theme. */
:root {
  --font-ui:
    ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI',
    Helvetica, 'Apple Color Emoji', Arial, sans-serif, 'Segoe UI Emoji', 'Segoe UI Symbol';
  --font-mono: 'SFMono-Regular', Menlo, Consolas, 'PT Mono', 'Liberation Mono', Courier, monospace;

  --bg: #ffffff;
  --bg-sidebar: #f8f8f7;
  --text: #32302c;
  --text-secondary: rgba(55, 53, 47, 0.65);
  --text-tertiary: rgba(55, 53, 47, 0.45);
  --sidebar-text: #5f5e5b;
  --divider: rgba(55, 53, 47, 0.09);
  --hover: rgba(55, 53, 47, 0.06);
  --hover-strong: rgba(55, 53, 47, 0.1);
  --selected: rgba(35, 131, 226, 0.14);
  --accent: #2383e2;
  --menu-bg: #ffffff;
  --menu-shadow:
    rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 3px 6px,
    rgba(15, 15, 15, 0.2) 0 9px 24px;
  --drop-line: rgba(35, 131, 226, 0.6);

  --color-gray: #787774;
  --color-brown: #9f6b53;
  --color-orange: #d9730d;
  --color-yellow: #cb912f;
  --color-green: #448361;
  --color-blue: #337ea9;
  --color-purple: #9065b0;
  --color-pink: #c14c8a;
  --color-red: #d44c47;
  --bg-gray: #f1f1ef;
  --bg-brown: #f4eeee;
  --bg-orange: #fbecdd;
  --bg-yellow: #fbf3db;
  --bg-green: #edf3ec;
  --bg-blue: #e7f3f8;
  --bg-purple: #f4f0f7;
  --bg-pink: #f9eef3;
  --bg-red: #fdebec;

  --sidebar-row-height: 30px;
  --topbar-height: 45px;
  --page-width: 708px;
  --page-padding: 96px;
}

:root[data-theme='dark'] {
  --bg: #191919;
  --bg-sidebar: #202020;
  --text: #d4d4d4;
  --text-secondary: rgba(255, 255, 255, 0.46);
  --text-tertiary: rgba(255, 255, 255, 0.28);
  --sidebar-text: #9b9b9b;
  --divider: rgba(255, 255, 255, 0.094);
  --hover: rgba(255, 255, 255, 0.055);
  --hover-strong: rgba(255, 255, 255, 0.09);
  --selected: rgba(35, 131, 226, 0.2);
  --menu-bg: #252525;
  --menu-shadow:
    rgba(15, 15, 15, 0.1) 0 0 0 1px, rgba(15, 15, 15, 0.2) 0 3px 6px,
    rgba(15, 15, 15, 0.4) 0 9px 24px;

  --color-gray: #9b9b9b;
  --color-brown: #ba856f;
  --color-orange: #c77d48;
  --color-yellow: #ca9849;
  --color-green: #529e72;
  --color-blue: #5e87c9;
  --color-purple: #9d68d3;
  --color-pink: #d15796;
  --color-red: #df5452;
  --bg-gray: #2f2f2f;
  --bg-brown: #4a3228;
  --bg-orange: #5c3b23;
  --bg-yellow: #56452f;
  --bg-green: #243d30;
  --bg-blue: #143a4e;
  --bg-purple: #3c2d49;
  --bg-pink: #4e2c3c;
  --bg-red: #522e2a;
}
````

`src/renderer/src/styles/app.css`:

````css
@import './tokens.css';

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  user-select: none;
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

::selection {
  background: rgba(35, 131, 226, 0.28);
}

.app {
  display: flex;
  height: 100%;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.drag-region {
  -webkit-app-region: drag;
}

.no-drag {
  -webkit-app-region: no-drag;
}

/* ---------- welcome ---------- */
.welcome {
  margin: auto;
  max-width: 420px;
  text-align: center;
  padding: 0 24px;
}
.welcome h1 {
  font-size: 32px;
  font-weight: 700;
  margin: 0 0 8px;
}
.welcome p {
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.5;
  margin: 0 0 24px;
}
.button-primary {
  background: var(--accent);
  color: #fff;
  border-radius: 6px;
  padding: 8px 14px;
  font-weight: 500;
  font-size: 14px;
}
.button-primary:hover {
  background: #0077d4;
}

/* ---------- sidebar ---------- */
.sidebar {
  position: relative;
  flex: none;
  background: var(--bg-sidebar);
  color: var(--sidebar-text);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--divider);
}
.sidebar-header {
  height: var(--topbar-height);
  padding: 0 10px 0 80px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  flex: none;
}
.sidebar-header .icon-button {
  width: 26px;
  height: 26px;
  color: var(--text-tertiary);
}
.sidebar-workspace {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  margin: 0 8px;
  padding: 0 6px;
  border-radius: 6px;
  font-weight: 500;
  color: var(--text);
  text-align: left;
  flex: none;
}
.sidebar-workspace:hover {
  background: var(--hover);
}
.sidebar-workspace-badge {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: var(--hover-strong);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 12px;
}
.sidebar-section {
  margin-top: 14px;
}
.sidebar-section-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  padding: 0 8px;
  height: 24px;
  display: flex;
  align-items: center;
}
.sidebar-row {
  height: var(--sidebar-row-height);
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding-right: 4px;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  text-align: left;
}
.sidebar-add {
  padding-left: 6px;
  color: var(--text-tertiary);
}
.sidebar-row-lead {
  position: relative;
  width: 22px;
  height: 22px;
  flex: none;
}
.sidebar-row-toggle {
  position: absolute;
  inset: 0;
  display: none;
}
.sidebar-row:hover .sidebar-row-lead.expandable .page-icon {
  visibility: hidden;
}
.sidebar-row:hover .sidebar-row-lead.expandable .sidebar-row-toggle {
  display: inline-flex;
}
.sidebar-row:hover {
  background: var(--hover);
}
.sidebar-row.active {
  background: var(--hover-strong);
  color: var(--text);
  font-weight: 500;
}
.sidebar-row.drop-inside {
  background: var(--selected);
}
.sidebar-row.drop-before::before,
.sidebar-row.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  background: var(--drop-line);
}
.sidebar-row.drop-before::before {
  top: -1px;
}
.sidebar-row.drop-after::after {
  bottom: -1px;
}
.sidebar-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-row-actions {
  display: none;
  gap: 2px;
}
.sidebar-row:hover .sidebar-row-actions,
.sidebar-row.menu-open .sidebar-row-actions {
  display: flex;
}
.icon-button {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  flex: none;
}
.icon-button:hover {
  background: var(--hover-strong);
  color: var(--text-secondary);
}
.toggle-arrow {
  transition: transform 120ms ease;
}
.toggle-arrow.open {
  transform: rotate(90deg);
}
.page-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  font-size: 16px;
  line-height: 1;
}
.page-icon img {
  width: 18px;
  height: 18px;
  object-fit: cover;
  border-radius: 3px;
}
.sidebar-empty {
  padding: 4px 8px 4px 36px;
  color: var(--text-tertiary);
  height: var(--sidebar-row-height);
  display: flex;
  align-items: center;
}
.sidebar-resize {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
}
.sidebar-resize:hover {
  background: var(--divider);
}
.rename-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 2px 4px;
  outline: none;
}

/* ---------- menus ---------- */
.menu {
  position: fixed;
  z-index: 100;
  min-width: 220px;
  background: var(--menu-bg);
  box-shadow: var(--menu-shadow);
  border-radius: 8px;
  padding: 4px;
  color: var(--text);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border-radius: 5px;
  text-align: left;
  font-size: 14px;
}
.menu-item:hover {
  background: var(--hover);
}
.menu-item.danger:hover {
  color: var(--color-red);
}
.menu-separator {
  height: 1px;
  background: var(--divider);
  margin: 4px 0;
}

/* ---------- top bar ---------- */
.topbar {
  height: var(--topbar-height);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  gap: 8px;
}
.topbar.sidebar-hidden {
  padding-left: 80px;
}
.breadcrumbs {
  display: flex;
  align-items: center;
  min-width: 0;
  color: var(--text);
}
.breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 200px;
  height: 24px;
  padding: 0 6px;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.breadcrumb:hover {
  background: var(--hover);
}
.breadcrumb-sep {
  color: var(--text-tertiary);
  padding: 0 2px;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.topbar-actions .icon-button {
  width: 28px;
  height: 28px;
  color: var(--text-secondary);
}
.topbar-actions .icon-button.on {
  color: var(--color-yellow);
}

/* ---------- page ---------- */
.page-scroll {
  flex: 1;
  overflow-y: auto;
  user-select: text;
}
.page-cover {
  position: relative;
  height: 30vh;
  max-height: 280px;
  min-height: 160px;
  background-size: cover;
}
.page-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.page-cover-actions {
  position: absolute;
  right: calc(50% - var(--page-width) / 2);
  bottom: 12px;
  display: none;
  gap: 4px;
}
.page-cover:hover .page-cover-actions {
  display: flex;
}
.cover-button {
  background: var(--menu-bg);
  color: var(--text-secondary);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  box-shadow: var(--menu-shadow);
}
.page-column {
  width: 100%;
  max-width: calc(var(--page-width) + var(--page-padding) * 2);
  padding: 0 var(--page-padding);
  margin: 0 auto;
}
.page-column.full-width {
  max-width: none;
}
.page-header {
  padding-top: 80px;
  position: relative;
}
.page-header.has-cover {
  padding-top: 0;
}
.page-header-icon {
  font-size: 78px;
  line-height: 1.1;
  width: 78px;
  height: 78px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  margin-bottom: 4px;
}
.page-header.has-cover .page-header-icon {
  margin-top: -42px;
  position: relative;
}
.page-header-icon:hover {
  background: var(--hover);
}
.page-header-icon img {
  width: 78px;
  height: 78px;
  object-fit: cover;
  border-radius: 4px;
}
.page-header-controls {
  display: flex;
  gap: 2px;
  height: 28px;
  margin-bottom: 4px;
  opacity: 0;
  transition: opacity 100ms ease;
}
.page-header:hover .page-header-controls {
  opacity: 1;
}
.page-header-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-tertiary);
  font-size: 14px;
  padding: 0 6px;
  height: 28px;
  border-radius: 4px;
}
.page-header-control:hover {
  background: var(--hover);
  color: var(--text-secondary);
}
.page-title {
  font-size: 40px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text);
  outline: none;
  padding: 3px 2px;
  margin: 0 0 4px;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: text;
}
.page-title:empty::before {
  content: attr(data-placeholder);
  color: var(--text-tertiary);
}
.page-body {
  padding-bottom: 30vh;
}

/* ---------- icon picker ---------- */
.icon-picker {
  padding: 4px 0 0;
  display: flex;
  flex-direction: column;
}
.icon-picker-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 8px;
  border-bottom: 1px solid var(--divider);
  margin-bottom: 4px;
}

/* The editor's own side padding would double the page column's; block handles live in the margin. */
.page-body .bn-editor {
  padding-inline: 0;
}
````

`src/renderer/src/store.ts`:

````ts
import { create } from 'zustand'
import type { Settings, TreeSnapshot } from '@shared/ipc'
import type { PageNode, WorkspaceInfo } from '@shared/types'
import { findNode, firstPageId } from './lib/tree'

const api = window.api

// Editors register a flush so pending autosaves land before destructive actions and quit.
const flushers = new Set<() => Promise<void>>()
export function registerFlusher(fn: () => Promise<void>): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}
export async function flushAll(): Promise<void> {
  await Promise.all([...flushers].map((fn) => fn()))
}

interface AppState {
  ready: boolean
  workspace: WorkspaceInfo | null
  tree: PageNode[]
  favorites: string[]
  settings: Settings | null
  currentId: string | null
  history: string[]
  historyIndex: number
  renamingId: string | null

  init: () => Promise<void>
  chooseWorkspace: () => Promise<void>
  applySnapshot: (snapshot: TreeSnapshot) => void
  openPage: (id: string) => void
  back: () => void
  forward: () => void
  createPage: (parentId: string | null, index?: number) => Promise<string>
  renamePage: (id: string, title: string) => Promise<void>
  movePage: (id: string, parentId: string | null, index: number) => Promise<void>
  trashPage: (id: string) => Promise<void>
  toggleFavorite: (id: string) => Promise<void>
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  setExpanded: (id: string, open: boolean) => Promise<void>
  setRenaming: (id: string | null) => void
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  workspace: null,
  tree: [],
  favorites: [],
  settings: null,
  currentId: null,
  history: [],
  historyIndex: -1,
  renamingId: null,

  init: async () => {
    const [settings, workspace] = await Promise.all([
      api.invoke('settings:get', undefined),
      api.invoke('workspace:current', undefined)
    ])
    set({ settings, workspace })
    if (workspace) {
      get().applySnapshot(await api.invoke('tree:get', undefined))
      const last = settings.lastPage[workspace.root]
      const start = last && findNode(get().tree, last) ? last : firstPageId(get().tree)
      if (start) get().openPage(start)
    }
    set({ ready: true })
  },

  chooseWorkspace: async () => {
    const workspace = await api.invoke('workspace:choose', undefined)
    if (!workspace) return
    set({ workspace, currentId: null, history: [], historyIndex: -1 })
    get().applySnapshot(await api.invoke('tree:get', undefined))
    const start = firstPageId(get().tree) ?? (await get().createPage(null))
    get().openPage(start)
  },

  applySnapshot: ({ pages, favorites }) => {
    set({ tree: pages, favorites })
    const { currentId } = get()
    if (currentId && !findNode(pages, currentId)) {
      const fallback = firstPageId(pages)
      set({ currentId: null })
      if (fallback) get().openPage(fallback)
    }
  },

  openPage: (id) => {
    const { history, historyIndex, currentId, workspace, settings } = get()
    if (id === currentId) return
    const nextHistory = [...history.slice(0, historyIndex + 1), id]
    set({ currentId: id, history: nextHistory, historyIndex: nextHistory.length - 1 })
    if (workspace && settings) {
      void get().updateSettings({ lastPage: { ...settings.lastPage, [workspace.root]: id } })
    }
  },

  back: () => {
    const { history, historyIndex, tree } = get()
    for (let i = historyIndex - 1; i >= 0; i--) {
      if (findNode(tree, history[i])) return set({ currentId: history[i], historyIndex: i })
    }
  },

  forward: () => {
    const { history, historyIndex, tree } = get()
    for (let i = historyIndex + 1; i < history.length; i++) {
      if (findNode(tree, history[i])) return set({ currentId: history[i], historyIndex: i })
    }
  },

  createPage: async (parentId, index) => {
    const node = await api.invoke('page:create', { parentId, index })
    if (parentId) await get().setExpanded(parentId, true)
    get().openPage(node.id)
    return node.id
  },

  renamePage: async (id, title) => {
    await api.invoke('page:rename', { id, title })
  },

  movePage: async (id, parentId, index) => {
    await api.invoke('page:move', { id, parentId, index })
    if (parentId) await get().setExpanded(parentId, true)
  },

  trashPage: async (id) => {
    await flushAll()
    await api.invoke('page:trash', { id })
  },

  toggleFavorite: async (id) => {
    await api.invoke('page:favorite', { id, favorite: !get().favorites.includes(id) })
  },

  updateSettings: async (patch) => {
    set({ settings: await api.invoke('settings:set', patch) })
  },

  setExpanded: async (id, open) => {
    const { settings, workspace } = get()
    if (!settings || !workspace) return
    const current = new Set(settings.expanded[workspace.root] ?? [])
    if (open === current.has(id)) return
    if (open) current.add(id)
    else current.delete(id)
    await get().updateSettings({
      expanded: { ...settings.expanded, [workspace.root]: [...current] }
    })
  },

  setRenaming: (id) => set({ renamingId: id })
}))
````

`src/renderer/src/lib/tree.ts`:

````ts
import type { PageNode } from '@shared/types'

export function findNode(nodes: PageNode[], id: string): PageNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return null
}

/** Nodes from the root down to (and including) `id`. */
export function pathTo(nodes: PageNode[], id: string): PageNode[] {
  for (const node of nodes) {
    if (node.id === id) return [node]
    const rest = pathTo(node.children, id)
    if (rest.length) return [node, ...rest]
  }
  return []
}

export function parentOf(nodes: PageNode[], id: string): PageNode | null {
  const path = pathTo(nodes, id)
  return path.length > 1 ? path[path.length - 2] : null
}

export function siblingsOf(nodes: PageNode[], parentId: string | null): PageNode[] {
  return parentId ? (findNode(nodes, parentId)?.children ?? []) : nodes
}

export function isDescendant(nodes: PageNode[], ancestorId: string, id: string): boolean {
  const ancestor = findNode(nodes, ancestorId)
  return ancestor ? findNode(ancestor.children, id) !== null : false
}

export function firstPageId(nodes: PageNode[]): string | null {
  return nodes[0]?.id ?? null
}

export type DropPosition = 'before' | 'after' | 'inside'

/** Parent and index (among siblings without the dragged page) for a sidebar drop. */
export function dropTarget(
  nodes: PageNode[],
  draggedId: string,
  targetId: string,
  position: DropPosition
): { parentId: string | null; index: number } | null {
  if (draggedId === targetId || isDescendant(nodes, draggedId, targetId)) return null
  if (position === 'inside') {
    const target = findNode(nodes, targetId)
    const count = target ? target.children.filter((c) => c.id !== draggedId).length : 0
    return { parentId: targetId, index: count }
  }
  const parentId = parentOf(nodes, targetId)?.id ?? null
  const siblings = siblingsOf(nodes, parentId).filter((n) => n.id !== draggedId)
  const at = siblings.findIndex((n) => n.id === targetId)
  return { parentId, index: position === 'before' ? at : at + 1 }
}
````

`src/renderer/src/lib/theme.ts`:

````ts
import { useEffect, useState } from 'react'
import type { ThemePreference } from '@shared/ipc'

const media = window.matchMedia('(prefers-color-scheme: dark)')

export function useEffectiveTheme(preference: ThemePreference | undefined): 'light' | 'dark' {
  const [systemDark, setSystemDark] = useState(media.matches)
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  const theme =
    preference === 'light' || preference === 'dark' ? preference : systemDark ? 'dark' : 'light'
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return theme
}

export function toggledPreference(current: 'light' | 'dark'): ThemePreference {
  return current === 'dark' ? 'light' : 'dark'
}
````

`src/renderer/src/lib/assets.ts`:

````ts
import { ASSET_SCHEME } from '@shared/ipc'

/** Internal workspace hrefs ("/attachments/x.png") become URLs the main process serves. */
export function resolveAssetUrl(href: string): string {
  if (href.startsWith('/') && !href.startsWith('//')) return `${ASSET_SCHEME}://workspace${href}`
  return href
}
````

`src/renderer/src/lib/navigation.ts`:

````ts
import { pageIdFromHref } from '@shared/core/links'
import { useApp } from '../store'

const api = window.api

/** Routes a link click: pages open in the app, attachments in their default app, the rest in the browser. */
export function openHref(href: string): void {
  const pageId = pageIdFromHref(href)
  if (pageId) return useApp.getState().openPage(pageId)
  if (href.startsWith('/') && !href.startsWith('//')) {
    void api.invoke('attachment:open', { href })
    return
  }
  void api.invoke('shell:openExternal', { url: href })
}
````

`src/renderer/src/components/icons.tsx`:

````tsx
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
      focusable={false}
      {...rest}
    >
      {children}
    </svg>
  )
}

export const ChevronRightIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M7.4 4.6a.75.75 0 0 1 1.06 0l4.87 4.87a.75.75 0 0 1 0 1.06L8.46 15.4a.75.75 0 1 1-1.06-1.06L11.74 10 7.4 5.66a.75.75 0 0 1 0-1.06Z" />
  </Svg>
)

export const PlusIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M10 3.75a.75.75 0 0 1 .75.75v4.75h4.75a.75.75 0 0 1 0 1.5h-4.75v4.75a.75.75 0 0 1-1.5 0v-4.75H4.5a.75.75 0 0 1 0-1.5h4.75V4.5a.75.75 0 0 1 .75-.75Z" />
  </Svg>
)

export const DotsIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="4.5" cy="10" r="1.5" />
    <circle cx="10" cy="10" r="1.5" />
    <circle cx="15.5" cy="10" r="1.5" />
  </Svg>
)

export const StarIcon = ({ filled, ...p }: IconProps & { filled?: boolean }): React.JSX.Element => (
  <Svg {...p}>
    <path
      d="M10 2.9l2.1 4.4 4.8.6-3.5 3.3.9 4.8L10 13.7 5.7 16l.9-4.8L3.1 7.9l4.8-.6L10 2.9Z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </Svg>
)

export const PageIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path
      d="M5.5 2.75h5.69c.2 0 .39.08.53.22l3.31 3.31c.14.14.22.33.22.53v9.44c0 .69-.56 1.25-1.25 1.25h-8.5c-.69 0-1.25-.56-1.25-1.25V4c0-.69.56-1.25 1.25-1.25Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <path
      d="M7 10h6M7 12.75h6M7 7.25h3"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </Svg>
)

export const ComposeIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4.75 5.5c0-.41.34-.75.75-.75h4a.75.75 0 0 0 0-1.5h-4A2.25 2.25 0 0 0 3.25 5.5v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-4a.75.75 0 0 0-1.5 0v4c0 .41-.34.75-.75.75h-9a.75.75 0 0 1-.75-.75v-9Z" />
    <path d="M14.47 2.97a1.75 1.75 0 0 1 2.48 2.48l-6.2 6.2-3.1.62.62-3.1 6.2-6.2Z" />
  </Svg>
)

export const SmileIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="7.75" cy="8.5" r="1" />
    <circle cx="12.25" cy="8.5" r="1" />
    <path
      d="M7.25 11.75c.6.9 1.6 1.5 2.75 1.5s2.15-.6 2.75-1.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </Svg>
)

export const ImageIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect
      x="3.25"
      y="4.25"
      width="13.5"
      height="11.5"
      rx="1.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <circle cx="7.5" cy="8.25" r="1.25" />
    <path
      d="M4 14.5l3.75-3.75 2.5 2.5 2-2 3.75 3.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </Svg>
)

export const SidebarIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect
      x="3.25"
      y="4.25"
      width="13.5"
      height="11.5"
      rx="1.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <path d="M8 4.5v11" stroke="currentColor" strokeWidth="1.4" />
  </Svg>
)

export const TrashIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path
      d="M8 3.25h4M4.5 5.75h11M6 5.75l.6 9.1c.05.79.7 1.4 1.5 1.4h3.8c.8 0 1.45-.61 1.5-1.4l.6-9.1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </Svg>
)
````

`src/renderer/src/components/Popover.tsx`:

````tsx
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PopoverProps {
  anchor: DOMRect
  align?: 'start' | 'end'
  onClose: () => void
  children: ReactNode
  className?: string
}

/** Fixed-position floating panel anchored under a rect; closes on outside click and Escape. */
export function Popover({
  anchor,
  align = 'start',
  onClose,
  children,
  className
}: PopoverProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: anchor.bottom + 4, left: anchor.left })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    let left = align === 'end' ? anchor.right - width : anchor.left
    let top = anchor.bottom + 4
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 4)
    setPos({ top, left })
  }, [anchor, align])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} className={`menu ${className ?? ''}`} style={{ top: pos.top, left: pos.left }}>
      {children}
    </div>,
    document.body
  )
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
}

export function Menu({
  anchor,
  align,
  items,
  onClose
}: {
  anchor: DOMRect
  align?: 'start' | 'end'
  items: (MenuItem | 'separator')[]
  onClose: () => void
}): React.JSX.Element {
  return (
    <Popover anchor={anchor} align={align} onClose={onClose}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="menu-separator" />
        ) : (
          <button
            key={item.label}
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.icon}
            {item.label}
          </button>
        )
      )}
    </Popover>
  )
}
````

`src/renderer/src/components/PageIconView.tsx`:

````tsx
import { resolveAssetUrl } from '../lib/assets'
import { PageIcon } from './icons'

/** Emoji, uploaded image, or the default document glyph. */
export function PageIconView({
  icon,
  size = 16
}: {
  icon?: string
  size?: number
}): React.JSX.Element {
  if (!icon) return <PageIcon size={size + 2} />
  if (icon.startsWith('/')) return <img src={resolveAssetUrl(icon)} alt="" />
  return <span>{icon}</span>
}
````

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 68 tests pass; no typecheck or lint output.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add src/renderer/src
git commit -m "Add renderer store, design tokens and shared UI pieces"
```

### Task 7: Editor module

The BlockNote editor configured to feel like Notion: custom callout, math, sub-page and raw blocks, inline math, a trimmed slash menu with Page/Callout/Equation/Columns, a formatting toolbar without alignment, link editing that never rewrites internal hrefs, an offline emoji picker, and Notion styling for every built-in block.

**Files:**
- Create: `src/renderer/src/editor/schema.tsx`, `Katex.tsx`, `slashItems.tsx`, `links.ts`, `LinkButtons.tsx`, `Editor.tsx`, `codeLanguages.ts`, `emojiData.ts`, `IconPicker.tsx`, `editor.css`, `icon-picker.css` (all under `src/renderer/src/editor/`)
- Test: `src/renderer/src/editor/links.test.ts`, `src/renderer/src/editor/codeLanguages.test.ts`

**Interfaces:**
- Consumes: `Block` (Task 2).
- Produces:
  - `schema`, `type AppSchema`, `AppEditor`, `AppBlock`, `AppPartialBlock`, `PageLinkContext`, `type PageLinkContextValue { resolve(href) => { title, icon? } | null; open(href) }` (from `schema.tsx`).
  - `Editor(props: { initialBlocks, theme, onChange(blocks), uploadFile(file) => Promise<string>, resolveFileUrl(url) => Promise<string>, createSubPage() => Promise<string>, openLink(href), pageLink })`; mount with `key={pageId}`; `onChange` does not fire on load.
  - `isValidLink(href)`, `normalizeLinkInput(input)`, `linkHrefFromEvent(event)` (from `links.ts`).
  - `createLanguageResolver(supported) => (lang) => id`, `withEditorLanguages(blocks, resolve)` (from `codeLanguages.ts`): maps fence languages like `ts` to highlighter ids; unknown languages become `text` (the highlighter throws on unsupported ids).
  - `IconPicker({ onSelect(emoji) })`, `resolveLocalEmojiData` (bundled `emojibase-data`, no network).
- Verified BlockNote 0.56 facts this relies on: `insertOrUpdateBlockForSlashMenu` (converting a paragraph carries over its `"default"` background, so callouts pass `backgroundColor: 'gray'` explicitly); `getFormattingToolbarItems()` keys `textAlign*`; `links.isValidLink` / `links.onClick`; `editor.createLink(url, text?)`, `editor.editLink(url, text, pos?)`; Shiki emits `--shiki-light`/`--shiki-dark` variables and BlockNote's CSS always picks dark.

- [ ] **Step 1: Write the failing tests**


`src/renderer/src/editor/links.test.ts`:

````ts
import { describe, expect, it } from 'vitest'
import { isValidLink, normalizeLinkInput } from './links'

describe('normalizeLinkInput', () => {
  const cases: [string, string][] = [
    ['', ''],
    ['  example.com  ', 'https://example.com'],
    ['sub.example.co.uk/path?q=1', 'https://sub.example.co.uk/path?q=1'],
    ['https://example.com', 'https://example.com'],
    ['nobsidian://page/123', 'nobsidian://page/123'],
    ['/attachments/a%20b.png', '/attachments/a%20b.png'],
    ['../Other.md', '../Other.md'],
    ['#heading', '#heading'],
    ['a@b.co', 'mailto:a@b.co'],
    ['notes', 'notes']
  ]
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      expect(normalizeLinkInput(input)).toBe(expected)
    })
  }
})

describe('isValidLink', () => {
  it('allows app, local and web links', () => {
    for (const ok of [
      'nobsidian://page/1',
      '/a.png',
      '../b.md',
      '#x',
      'https://a.b',
      'mailto:a@b.c'
    ]) {
      expect(isValidLink(ok)).toBe(true)
    }
  })
  it('blocks script and file schemes, even when obfuscated', () => {
    for (const bad of [
      'javascript:alert(1)',
      ' java\tscript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd'
    ]) {
      expect(isValidLink(bad)).toBe(false)
    }
  })
})
````

`src/renderer/src/editor/codeLanguages.test.ts`:

````ts
import { expect, it } from 'vitest'
import type { Block } from '@shared/core/blocks'
import { createLanguageResolver, withEditorLanguages } from './codeLanguages'

const resolve = createLanguageResolver({
  text: { name: 'Plain Text', aliases: ['text', 'txt'] },
  typescript: { name: 'TypeScript', aliases: ['ts'] }
})

it('maps aliases to highlighter ids and unknown languages to plain text', () => {
  expect(resolve('ts')).toBe('typescript')
  expect(resolve('TypeScript')).toBe('typescript')
  expect(resolve('dockerfile')).toBe('text')
})

it('rewrites nested code blocks', () => {
  const code: Block = { type: 'codeBlock', props: { language: 'ts' }, content: [], children: [] }
  const doc: Block[] = [{ type: 'toggleListItem', props: {}, content: [], children: [code] }]
  expect(withEditorLanguages(doc, resolve)[0].children[0]).toMatchObject({
    props: { language: 'typescript' }
  })
})
````

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test src/renderer/src/editor`
Expected: FAIL with "Failed to resolve import ./links" and "./codeLanguages".

- [ ] **Step 3: Write the implementation**


`src/renderer/src/editor/schema.tsx`:

````tsx
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultProps,
  type Block,
  type PartialBlock
} from '@blocknote/core'
import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react'
import { codeBlockOptions } from '@blocknote/code-block'
import { withMultiColumn } from '@blocknote/xl-multi-column'
import { createContext, useContext, useState } from 'react'
import { Katex } from './Katex'

export type PageLinkContextValue = {
  resolve(href: string): { title: string; icon?: string } | null
  open(href: string): void
}

export const PageLinkContext = createContext<PageLinkContextValue | null>(null)

export const createCallout = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: {
      textColor: defaultProps.textColor,
      backgroundColor: { default: 'gray' },
      icon: { default: '💡' }
    },
    content: 'inline'
  },
  {
    render: ({ block, contentRef }) => (
      // BlockNote paints backgroundColor/textColor on the enclosing .bn-block.
      <div className="nb-callout">
        <span className="nb-callout-icon" contentEditable={false}>
          {block.props.icon}
        </span>
        <div className="nb-callout-content" ref={contentRef} />
      </div>
    )
  }
)

export const createMath = createReactBlockSpec(
  {
    type: 'math',
    propSchema: { latex: { default: '' } },
    content: 'none'
  },
  {
    render: function MathBlock({ block, editor }) {
      const [editing, setEditing] = useState(false)
      if (editing) {
        return (
          <textarea
            className="nb-math-source"
            autoFocus
            defaultValue={block.props.latex}
            onBlur={(e) => {
              editor.updateBlock(block, {
                props: { latex: e.currentTarget.value }
              })
              setEditing(false)
            }}
          />
        )
      }
      return (
        <div className="nb-math" onClick={() => editor.isEditable && setEditing(true)}>
          {block.props.latex ? (
            <Katex latex={block.props.latex} displayMode />
          ) : (
            <span className="nb-math-empty">Add a TeX equation</span>
          )}
        </div>
      )
    }
  }
)

export const createPageLink = createReactBlockSpec(
  {
    type: 'pageLink',
    propSchema: { href: { default: '' } },
    content: 'none'
  },
  {
    render: function PageLinkBlock({ block }) {
      const ctx = useContext(PageLinkContext)
      const target = ctx?.resolve(block.props.href)
      return (
        <div
          className="nb-page-link"
          data-missing={target ? undefined : 'true'}
          onClick={() => ctx?.open(block.props.href)}
        >
          <span className="nb-page-link-icon">{target?.icon ?? '📄'}</span>
          <span className="nb-page-link-title">{target?.title ?? block.props.href}</span>
        </div>
      )
    }
  }
)

export const createRaw = createReactBlockSpec(
  {
    type: 'raw',
    propSchema: { markdown: { default: '' } },
    content: 'none'
  },
  {
    render: ({ block }) => <pre className="nb-raw">{block.props.markdown}</pre>
  }
)

export const InlineMath = createReactInlineContentSpec(
  {
    type: 'inlineMath',
    propSchema: { latex: { default: '' } },
    content: 'none'
  },
  {
    render: ({ inlineContent }) => (
      <span className="nb-inline-math">
        <Katex latex={inlineContent.props.latex} displayMode={false} />
      </span>
    )
  }
)

export const schema = withMultiColumn(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      codeBlock: createCodeBlockSpec(codeBlockOptions),
      callout: createCallout(),
      math: createMath(),
      pageLink: createPageLink(),
      raw: createRaw()
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      inlineMath: InlineMath
    }
  })
)

export type AppSchema = typeof schema
export type AppEditor = AppSchema['BlockNoteEditor']
export type AppBlock = Block<
  AppSchema['blockSchema'],
  AppSchema['inlineContentSchema'],
  AppSchema['styleSchema']
>
export type AppPartialBlock = PartialBlock<
  AppSchema['blockSchema'],
  AppSchema['inlineContentSchema'],
  AppSchema['styleSchema']
>
````

`src/renderer/src/editor/Katex.tsx`:

````tsx
import katex from 'katex'
import { useLayoutEffect, useRef } from 'react'

// katex.render builds DOM and sets styles through CSSOM, which a `default-src 'self'`
// CSP allows; renderToString + innerHTML relies on style attributes, which it blocks.
export function Katex(props: { latex: string; displayMode: boolean }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    katex.render(props.latex, ref.current, {
      displayMode: props.displayMode,
      throwOnError: false
    })
  }, [props.latex, props.displayMode])
  return <span ref={ref} />
}
````

`src/renderer/src/editor/slashItems.tsx`:

````tsx
import {
  combineByGroup,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu
} from '@blocknote/core'
import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from '@blocknote/react'
import { getMultiColumnSlashMenuItems } from '@blocknote/xl-multi-column'
import type { AppEditor, AppPartialBlock } from './schema'

// The React items carry core's `key` at runtime, but their type omits it.
type KeyedItem = DefaultReactSuggestionItem & { key?: string }

const EXCLUDED_KEYS = new Set([
  'heading_4',
  'heading_5',
  'heading_6',
  'toggle_heading_4',
  'toggle_heading_5',
  'toggle_heading_6'
])

// The menu draws a group header whenever the group changes, so groups must be contiguous.
function groupAdjacent<T extends { group?: string }>(items: T[]): T[] {
  const order = new Map<string | undefined, number>()
  for (const item of items) {
    if (!order.has(item.group)) order.set(item.group, order.size)
  }
  return [...items].sort((a, b) => order.get(a.group)! - order.get(b.group)!)
}

export type SlashItemOptions = {
  createSubPage: () => Promise<string>
}

// The suggestion menu removes the "/" query before onItemClick runs, so the
// block under the cursor is the one the menu was opened in.
async function insertPageLink(
  editor: AppEditor,
  createSubPage: () => Promise<string>
): Promise<void> {
  const originId = editor.getTextCursorPosition().block.id
  const href = await createSubPage()
  const block: AppPartialBlock = { type: 'pageLink', props: { href } }
  if (editor.getBlock(originId)) {
    editor.setTextCursorPosition(originId, 'end')
    insertOrUpdateBlockForSlashMenu(editor, block)
  } else {
    const last = editor.document[editor.document.length - 1]
    editor.insertBlocks([block], last, 'after')
  }
}

export function getSlashItems(
  editor: AppEditor,
  opts: SlashItemOptions
): DefaultReactSuggestionItem[] {
  const defaults = groupAdjacent(
    getDefaultReactSlashMenuItems(editor)
      .filter((item: KeyedItem) => !(item.key && EXCLUDED_KEYS.has(item.key)))
      .map((item: KeyedItem) =>
        item.key?.startsWith('toggle_heading') ? { ...item, group: 'Headings' } : item
      )
  )

  const custom: DefaultReactSuggestionItem[] = [
    {
      title: 'Page',
      subtext: 'Embed a sub-page inside this page',
      aliases: ['page', 'subpage', 'link'],
      group: 'Basic blocks',
      icon: <span>📄</span>,
      onItemClick: () => {
        void insertPageLink(editor, opts.createSubPage)
      }
    },
    {
      title: 'Callout',
      subtext: 'Make writing stand out',
      aliases: ['callout', 'note', 'info', 'tip'],
      group: 'Basic blocks',
      icon: <span>💡</span>,
      onItemClick: () => {
        // Converting a paragraph would otherwise carry over its "default" background.
        insertOrUpdateBlockForSlashMenu(editor, {
          type: 'callout',
          props: { backgroundColor: 'gray' }
        })
      }
    },
    {
      title: 'Block equation',
      subtext: 'Display a standalone math equation',
      aliases: ['math', 'equation', 'latex', 'tex', 'katex'],
      group: 'Advanced',
      icon: <span>∑</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, { type: 'math' })
      }
    }
  ]

  return combineByGroup(defaults, getMultiColumnSlashMenuItems(editor), custom)
}

export async function querySlashItems(
  editor: AppEditor,
  opts: SlashItemOptions,
  query: string
): Promise<DefaultReactSuggestionItem[]> {
  return filterSuggestionItems(getSlashItems(editor, opts), query)
}
````

`src/renderer/src/editor/links.ts`:

````ts
const ALLOWED_SCHEME = /^(?:https?|mailto|tel|nobsidian):/i
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const LOCAL_PREFIX = /^(?:\/|\.\/|\.\.\/|#)/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/

// Replaces BlockNote's default (not exported from 0.56), which rejects nobsidian://.
// Scheme-less hrefs (/attachments/..., ../Other.md, #x) are always allowed.
export function isValidLink(href: string): boolean {
  // Browsers ignore whitespace and control characters inside schemes ("java\tscript:").
  const cleaned = [...href]
    .filter((c) => c.trim() !== '' && c.charCodeAt(0) > 0x1f && c.charCodeAt(0) !== 0x7f)
    .join('')
  return ALLOWED_SCHEME.test(cleaned) || !ANY_SCHEME.test(cleaned)
}

// Replaces BlockNote's link form normalization, which prefixes https:// to anything
// outside a fixed protocol list (turning /a.png into https:///a.png).
export function normalizeLinkInput(input: string): string {
  const value = input.trim()
  if (value === '') return ''
  if (LOCAL_PREFIX.test(value) || ANY_SCHEME.test(value)) return value
  if (EMAIL.test(value)) return `mailto:${value}`
  if (BARE_DOMAIN.test(value)) return `https://${value}`
  return value
}

export function linkHrefFromEvent(event: MouseEvent): string | null {
  const target = event.target instanceof Element ? event.target : null
  return target?.closest('a[href]')?.getAttribute('href') ?? null
}
````

`src/renderer/src/editor/LinkButtons.tsx`:

````tsx
import { formatKeyboardShortcut, isTableCellSelection } from '@blocknote/core'
import { FormattingToolbarExtension, ShowSelectionExtension } from '@blocknote/core/extensions'
import {
  ScreenReaderOnlySubmit,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorDOMElement,
  useEditorState,
  useExtension,
  usePortalElement,
  type LinkToolbarProps
} from '@blocknote/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeLinkInput } from './links'
import type { AppSchema } from './schema'

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

export function LinkIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  )
}

function TextIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </svg>
  )
}

function LinkForm(props: {
  url: string
  text?: string
  onSubmit(url: string, text: string): void
}): React.JSX.Element {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  // Callers key the form by url and text, so fresh values remount it instead of syncing state.
  const [url, setUrl] = useState(props.url)
  const [text, setText] = useState(props.text ?? '')

  return (
    <Components.Generic.Form.Root
      onSubmit={() => props.onSubmit(normalizeLinkInput(url), text)}
      submitButton={<ScreenReaderOnlySubmit />}
    >
      <Components.Generic.Form.TextInput
        className="bn-text-input"
        name="url"
        icon={<LinkIcon />}
        autoFocus
        placeholder={dict.link_toolbar.form.url_placeholder}
        value={url}
        onChange={(e) => setUrl(e.currentTarget.value)}
      />
      {props.text !== undefined && (
        <Components.Generic.Form.TextInput
          className="bn-text-input"
          name="title"
          icon={<TextIcon />}
          placeholder={dict.link_toolbar.form.title_placeholder}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      )}
    </Components.Generic.Form.Root>
  )
}

// Same visibility rules, Mod+K shortcut and selection highlight as BlockNote's CreateLinkButton.
export function AppCreateLinkButton(): React.JSX.Element | null {
  const editor = useBlockNoteEditor<
    AppSchema['blockSchema'],
    AppSchema['inlineContentSchema'],
    AppSchema['styleSchema']
  >()
  const editorDOMElement = useEditorDOMElement()
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const portalElement = usePortalElement()
  const formattingToolbar = useExtension(FormattingToolbarExtension)
  const { showSelection } = useExtension(ShowSelectionExtension)
  // The popover belongs to one selection: moving the selection closes it.
  const [openFor, setOpenFor] = useState<string | null>(null)
  const selectionKey = useRef('')

  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const selection = editor.prosemirrorState.selection
      const hasInlineContent = (
        editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
      ).some((block) => block.content !== undefined)
      if (
        !editor.isEditable ||
        selection.empty ||
        !('link' in editor.schema.inlineContentSchema) ||
        isTableCellSelection(selection) ||
        !hasInlineContent
      ) {
        return undefined
      }
      return { url: editor.getSelectedLinkUrl() ?? '', from: selection.from, to: selection.to }
    }
  })
  const key = state ? `${state.from}:${state.to}` : ''
  useEffect(() => {
    selectionKey.current = key
  }, [key])
  const open = openFor !== null && openFor === key

  useEffect(() => {
    showSelection(open, 'appCreateLinkButton')
    return () => showSelection(false, 'appCreateLinkButton')
  }, [open, showSelection])

  const setPopoverOpen = useCallback(
    (next: boolean) => {
      if (!next) editor.focus()
      setOpenFor(next ? selectionKey.current : null)
    },
    [editor]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!editor.isEditable) return
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        setOpenFor(selectionKey.current)
        event.preventDefault()
      }
    }
    editorDOMElement?.addEventListener('keydown', onKeyDown)
    return () => editorDOMElement?.removeEventListener('keydown', onKeyDown)
  }, [editor, editorDOMElement])

  if (state === undefined) return null

  return (
    <Components.Generic.Popover.Root
      open={open}
      onOpenChange={setPopoverOpen}
      portalElement={portalElement}
    >
      <Components.Generic.Popover.Trigger>
        <Components.FormattingToolbar.Button
          className="bn-button"
          data-test="createLink"
          label={dict.formatting_toolbar.link.tooltip}
          mainTooltip={dict.formatting_toolbar.link.tooltip}
          secondaryTooltip={formatKeyboardShortcut(
            dict.formatting_toolbar.link.secondary_tooltip,
            dict.generic.ctrl_shortcut
          )}
          icon={<LinkIcon />}
          onClick={() => setPopoverOpen(!open)}
        />
      </Components.Generic.Popover.Trigger>
      <Components.Generic.Popover.Content
        className="bn-popover-content bn-form-popover"
        variant="form-popover"
      >
        <LinkForm
          key={state.url}
          url={state.url}
          onSubmit={(url) => {
            if (url === '') return
            editor.createLink(url)
            formattingToolbar.store.setState(false)
          }}
        />
      </Components.Generic.Popover.Content>
    </Components.Generic.Popover.Root>
  )
}

export function AppEditLinkButton(
  props: Pick<
    LinkToolbarProps,
    'url' | 'text' | 'range' | 'setToolbarOpen' | 'setToolbarPositionFrozen'
  >
): React.JSX.Element {
  const editor = useBlockNoteEditor<
    AppSchema['blockSchema'],
    AppSchema['inlineContentSchema'],
    AppSchema['styleSchema']
  >()
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const portalElement = usePortalElement()

  return (
    <Components.Generic.Popover.Root
      onOpenChange={props.setToolbarPositionFrozen}
      portalElement={portalElement}
    >
      <Components.Generic.Popover.Trigger>
        <Components.LinkToolbar.Button
          className="bn-button"
          mainTooltip={dict.link_toolbar.edit.tooltip}
          isSelected={false}
        >
          {dict.link_toolbar.edit.text}
        </Components.LinkToolbar.Button>
      </Components.Generic.Popover.Trigger>
      <Components.Generic.Popover.Content
        className="bn-popover-content bn-form-popover"
        variant="form-popover"
      >
        <LinkForm
          key={`${props.url}\n${props.text}`}
          url={props.url}
          text={props.text}
          onSubmit={(url, text) => {
            if (url === '') {
              editor.deleteLink(props.range.from)
            } else {
              editor.editLink(url, text || props.text, props.range.from)
            }
            props.setToolbarOpen?.(false)
            props.setToolbarPositionFrozen?.(false)
          }}
        />
      </Components.Generic.Popover.Content>
    </Components.Generic.Popover.Root>
  )
}
````

`src/renderer/src/editor/Editor.tsx`:

````tsx
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import 'katex/dist/katex.min.css'
import './editor.css'

import { en } from '@blocknote/core/locales'
import { syntaxHighlighter } from '@blocknote/code-block'
import { BlockNoteView } from '@blocknote/mantine'
import {
  DeleteLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  LinkToolbar,
  LinkToolbarController,
  SuggestionMenuController,
  useComponentsContext,
  useCreateBlockNote,
  useDictionary,
  type LinkToolbarProps
} from '@blocknote/react'
import { locales as multiColumnLocales, multiColumnDropCursor } from '@blocknote/xl-multi-column'
import { createContext, useContext } from 'react'
import { AppCreateLinkButton, AppEditLinkButton } from './LinkButtons'
import { isValidLink, linkHrefFromEvent } from './links'
import {
  PageLinkContext,
  schema,
  type AppBlock,
  type AppPartialBlock,
  type PageLinkContextValue
} from './schema'
import { querySlashItems } from './slashItems'

export type EditorProps = {
  initialBlocks: AppPartialBlock[]
  theme: 'light' | 'dark'
  onChange(blocks: AppBlock[]): void
  uploadFile(file: File): Promise<string>
  resolveFileUrl(url: string): Promise<string>
  createSubPage(): Promise<string>
  openLink(href: string): void
  pageLink: PageLinkContextValue
}

const OpenLinkContext = createContext<(href: string) => void>(() => {})

// Default items minus text alignment, with link creation that doesn't rewrite hrefs.
function AppFormattingToolbar(): React.JSX.Element {
  return (
    <FormattingToolbar>
      {getFormattingToolbarItems()
        .filter((item) => !String(item.key).startsWith('textAlign'))
        .map((item) =>
          item.key === 'createLinkButton' ? <AppCreateLinkButton key="createLinkButton" /> : item
        )}
    </FormattingToolbar>
  )
}

// The default "Open" button calls window.open on the URL resolved against the page URL,
// and the default edit form prefixes https:// to hrefs outside a fixed protocol list.
function AppLinkToolbar(props: LinkToolbarProps): React.JSX.Element {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const openLink = useContext(OpenLinkContext)
  return (
    <LinkToolbar {...props}>
      <AppEditLinkButton
        url={props.url}
        text={props.text}
        range={props.range}
        setToolbarOpen={props.setToolbarOpen}
        setToolbarPositionFrozen={props.setToolbarPositionFrozen}
      />
      <Components.LinkToolbar.Button
        className="bn-button"
        mainTooltip={dict.link_toolbar.open.tooltip}
        label={dict.link_toolbar.open.tooltip}
        isSelected={false}
        onClick={() => openLink(props.url)}
        icon={<span aria-hidden>↗</span>}
      />
      <DeleteLinkButton range={props.range} setToolbarOpen={props.setToolbarOpen} />
    </LinkToolbar>
  )
}

// Mount with `key={pageId}`: the editor is created once from initialBlocks.
export function Editor(props: EditorProps): React.JSX.Element {
  const editor = useCreateBlockNote({
    schema,
    initialContent: props.initialBlocks.length ? props.initialBlocks : undefined,
    dictionary: { ...en, multi_column: multiColumnLocales.en },
    dropCursor: multiColumnDropCursor,
    extensions: [syntaxHighlighter],
    uploadFile: (file) => props.uploadFile(file),
    resolveFileUrl: (url) => props.resolveFileUrl(url),
    links: {
      isValidLink,
      onClick: (event) => {
        const href = linkHrefFromEvent(event)
        if (!href) return false
        event.preventDefault()
        props.openLink(href)
        return true
      }
    }
  })

  return (
    <PageLinkContext.Provider value={props.pageLink}>
      <OpenLinkContext.Provider value={props.openLink}>
        <BlockNoteView
          editor={editor}
          theme={props.theme}
          slashMenu={false}
          formattingToolbar={false}
          linkToolbar={false}
          onChange={(ed) => props.onChange(ed.document)}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={(query) =>
              querySlashItems(editor, { createSubPage: props.createSubPage }, query)
            }
          />
          <FormattingToolbarController formattingToolbar={AppFormattingToolbar} />
          <LinkToolbarController linkToolbar={AppLinkToolbar} />
        </BlockNoteView>
      </OpenLinkContext.Provider>
    </PageLinkContext.Provider>
  )
}
````

`src/renderer/src/editor/codeLanguages.ts`:

````ts
import type { Block } from '@shared/core/blocks'

type Supported = Record<string, { name: string; aliases?: string[] }>

/**
 * The highlighter only accepts its own language ids ("typescript", not "ts") and
 * crashes on anything else, so fence languages are mapped before loading.
 */
export function createLanguageResolver(supported: Supported): (lang: string) => string {
  const byAlias = new Map<string, string>()
  for (const [id, lang] of Object.entries(supported)) {
    byAlias.set(id.toLowerCase(), id)
    for (const alias of lang.aliases ?? []) byAlias.set(alias.toLowerCase(), id)
  }
  return (lang) => byAlias.get(lang.toLowerCase()) ?? 'text'
}

export function withEditorLanguages(blocks: Block[], resolve: (lang: string) => string): Block[] {
  return blocks.map((block) => {
    const children = withEditorLanguages(block.children, resolve)
    if (block.type === 'codeBlock') {
      return {
        ...block,
        props: { ...block.props, language: resolve(block.props.language) },
        children
      }
    }
    return { ...block, children } as Block
  })
}
````

`src/renderer/src/editor/emojiData.ts`:

````ts
import type { Emoji as EmojibaseEmoji, MessagesDataset } from 'emojibase'
import type { EmojiData, EmojiDataResolver } from 'frimousse'

type SkinToneKey = 'light' | 'medium-light' | 'medium' | 'medium-dark' | 'dark'
type SkinTones = Record<SkinToneKey, string>

const TONE_KEYS: (SkinToneKey | undefined)[] = [
  undefined,
  'light',
  'medium-light',
  'medium',
  'medium-dark',
  'dark'
]

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

let canvas: CanvasRenderingContext2D | null | undefined

// Same technique as frimousse's default resolver: an emoji the OS font can't draw
// renders as monochrome tofu, so blue and red fills produce identical pixels.
function rendersAsColorEmoji(emoji: string): boolean {
  canvas ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!canvas) return true
  const size = 2
  canvas.canvas.width = size
  canvas.canvas.height = size
  canvas.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  canvas.textBaseline = 'middle'
  if (canvas.measureText(emoji).width >= size * 2) return false
  canvas.fillStyle = '#00f'
  canvas.fillText(emoji, 0, 0)
  const blue = canvas.getImageData(0, 0, size, size).data
  canvas.clearRect(0, 0, size, size)
  canvas.fillStyle = '#f00'
  canvas.fillText(emoji, 0, 0)
  const red = canvas.getImageData(0, 0, size, size).data
  canvas.clearRect(0, 0, size, size)
  for (let i = 0; i < blue.length; i += 4) {
    if (blue[i] !== red[i] || blue[i + 1] !== red[i + 1] || blue[i + 2] !== red[i + 2]) {
      return false
    }
  }
  return true
}

function newestSupportedVersion(emojis: EmojibaseEmoji[]): number {
  const firstOfVersion = new Map<number, string>()
  for (const e of emojis) if (!firstOfVersion.has(e.version)) firstOfVersion.set(e.version, e.emoji)
  const versions = [...firstOfVersion.keys()].sort((a, b) => b - a)
  return versions.find((v) => rendersAsColorEmoji(firstOfVersion.get(v)!)) ?? versions[0] ?? 0
}

export function toEmojiData(
  emojis: EmojibaseEmoji[],
  messages: MessagesDataset,
  options: { emojiVersion?: number; countryFlags?: boolean } = {}
): EmojiData {
  const flagSubgroups = new Set(
    messages.subgroups
      .filter((s) => s.key === 'country-flag' || s.key === 'subdivision-flag')
      .map((s) => s.order)
  )
  const maxVersion = options.emojiVersion ?? newestSupportedVersion(emojis)
  const countryFlags = options.countryFlags ?? rendersAsColorEmoji('🇪🇺')

  const skinTones = {} as SkinTones
  for (const tone of messages.skinTones) skinTones[tone.key] = capitalize(tone.message)

  // "component" (skin tone and hair swatches) is not a pickable category.
  const categories = messages.groups
    .filter((g) => g.key !== 'component')
    .map((g) => ({ index: g.order, label: capitalize(g.message) }))
  const categoryIndexes = new Set(categories.map((c) => c.index))

  return {
    locale: 'en',
    categories,
    skinTones,
    emojis: emojis
      .filter(
        (e) => e.group !== undefined && categoryIndexes.has(e.group) && e.version <= maxVersion
      )
      .filter((e) => countryFlags || !flagSubgroups.has(e.subgroup ?? -1))
      .map((e) => {
        const skins = {} as SkinTones
        const aliases: string[] = []
        for (const skin of e.skins ?? []) {
          const key = typeof skin.tone === 'number' ? TONE_KEYS[skin.tone] : undefined
          if (key) skins[key] = skin.emoji
          else aliases.push(skin.emoji)
        }
        return {
          emoji: e.emoji,
          category: e.group!,
          label: capitalize(e.label),
          version: e.version,
          tags: e.tags ?? [],
          skins: e.skins?.length ? skins : undefined,
          aliases: aliases.length ? aliases : undefined
        }
      })
  }
}

// Must be a stable module-level reference: frimousse caches results per resolver function.
// Dynamic imports keep the ~800 KB dataset out of the main chunk; Vite bundles it as a local asset.
export const resolveLocalEmojiData: EmojiDataResolver = async (
  _locale,
  { emojiVersion, signal }
) => {
  const [{ default: emojis }, { default: messages }] = await Promise.all([
    import('emojibase-data/en/data.json'),
    import('emojibase-data/en/messages.json')
  ])
  signal?.throwIfAborted()
  return toEmojiData(emojis as EmojibaseEmoji[], messages as MessagesDataset, { emojiVersion })
}
````

`src/renderer/src/editor/IconPicker.tsx`:

````tsx
import './icon-picker.css'

import { EmojiPicker, type Emoji } from 'frimousse'
import { resolveLocalEmojiData } from './emojiData'

export type IconPickerProps = {
  onSelect(emoji: string): void
}

export function IconPicker(props: IconPickerProps): React.JSX.Element {
  return (
    <EmojiPicker.Root
      className="nb-icon-picker"
      columns={12}
      resolveEmojiData={resolveLocalEmojiData}
      onEmojiSelect={(emoji: Emoji) => props.onSelect(emoji.emoji)}
    >
      <EmojiPicker.Search className="nb-icon-picker-search" placeholder="Filter…" autoFocus />
      <EmojiPicker.Viewport className="nb-icon-picker-viewport">
        <EmojiPicker.Loading className="nb-icon-picker-status">Loading…</EmojiPicker.Loading>
        <EmojiPicker.Empty className="nb-icon-picker-status">No emoji found.</EmojiPicker.Empty>
        <EmojiPicker.List
          className="nb-icon-picker-list"
          components={{
            CategoryHeader: ({ category, ...rest }) => (
              <div className="nb-icon-picker-category" {...rest}>
                {category.label}
              </div>
            ),
            Row: ({ children, ...rest }) => (
              <div className="nb-icon-picker-row" {...rest}>
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...rest }) => (
              <button className="nb-icon-picker-emoji" {...rest}>
                {emoji.emoji}
              </button>
            )
          }}
        />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  )
}
````

`src/renderer/src/editor/editor.css`:

````css
/* Must load after @blocknote/mantine/style.css: equal-specificity overrides win by order. */

.bn-root {
  --nb-font-notion:
    ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI',
    Helvetica, 'Apple Color Emoji', Arial, sans-serif, 'Segoe UI Emoji', 'Segoe UI Symbol';
  --bn-font-family: var(--nb-font-notion);
}

/* Editor content font is hardcoded on .bn-default-styles in core CSS, not read from --bn-font-family. */
.bn-root .bn-default-styles {
  font-family: var(--nb-font-notion);
}

.bn-root[data-color-scheme='light'] {
  --bn-colors-editor-text: #37352f;
  --bn-colors-editor-background: #ffffff;
  --bn-colors-highlights-gray-text: #787774;
  --bn-colors-highlights-gray-background: #f1f1ef;
  --bn-colors-highlights-brown-text: #9f6b53;
  --bn-colors-highlights-brown-background: #f4eeee;
  --bn-colors-highlights-orange-text: #d9730d;
  --bn-colors-highlights-orange-background: #fbecdd;
  --bn-colors-highlights-yellow-text: #cb912f;
  --bn-colors-highlights-yellow-background: #fbf3db;
  --bn-colors-highlights-green-text: #448361;
  --bn-colors-highlights-green-background: #edf3ec;
  --bn-colors-highlights-blue-text: #337ea9;
  --bn-colors-highlights-blue-background: #e7f3f8;
  --bn-colors-highlights-purple-text: #9065b0;
  --bn-colors-highlights-purple-background: #f6f3f9;
  --bn-colors-highlights-pink-text: #c14c8a;
  --bn-colors-highlights-pink-background: #faf1f5;
  --bn-colors-highlights-red-text: #d44c47;
  --bn-colors-highlights-red-background: #fdebec;
}

.bn-root[data-color-scheme='dark'] {
  --bn-colors-editor-text: #d4d4d4;
  --bn-colors-editor-background: #191919;
  --bn-colors-highlights-gray-text: #9b9b9b;
  --bn-colors-highlights-gray-background: #2f2f2f;
  --bn-colors-highlights-brown-text: #ba856f;
  --bn-colors-highlights-brown-background: #4a3228;
  --bn-colors-highlights-orange-text: #c77d48;
  --bn-colors-highlights-orange-background: #5c3b23;
  --bn-colors-highlights-yellow-text: #ca9849;
  --bn-colors-highlights-yellow-background: #564328;
  --bn-colors-highlights-green-text: #529e72;
  --bn-colors-highlights-green-background: #243d30;
  --bn-colors-highlights-blue-text: #379ad3;
  --bn-colors-highlights-blue-background: #143a4e;
  --bn-colors-highlights-purple-text: #9d68d3;
  --bn-colors-highlights-purple-background: #3c2d49;
  --bn-colors-highlights-pink-text: #d15796;
  --bn-colors-highlights-pink-background: #4e2c3c;
  --bn-colors-highlights-red-text: #df5452;
  --bn-colors-highlights-red-background: #522e2a;
}

/* Callout: BlockNote paints the color on .bn-block, so the box spans content and children. */
.bn-block:has(> .react-renderer > .bn-block-content[data-content-type='callout']) {
  border-radius: 4px;
  padding: 12px 16px 12px 12px;
}

.bn-block-content[data-content-type='callout'] {
  background-color: transparent;
}

/* Children sit inside the box, aligned with the text after the icon, without the nesting guide line. */
.bn-block:has(> .react-renderer > .bn-block-content[data-content-type='callout'])
  > .bn-block-group {
  margin-left: 30px;
}

.bn-block:has(> .react-renderer > .bn-block-content[data-content-type='callout'])
  > .bn-block-group
  > .bn-block-outer::before {
  display: none;
}

.nb-callout {
  display: flex;
  gap: 8px;
  width: 100%;
}

.nb-callout-icon {
  flex: none;
  font-size: 1.2em;
  line-height: 1.5;
  user-select: none;
}

.nb-callout-content {
  flex: 1;
  min-width: 0;
}

.nb-math {
  width: 100%;
  padding: 4px 0;
  border-radius: 4px;
  cursor: pointer;
}

.nb-math:hover {
  background-color: var(--bn-colors-hovered-background);
}

.nb-math-empty {
  color: var(--bn-colors-highlights-gray-text);
}

.nb-math-source {
  width: 100%;
  min-height: 4em;
  padding: 8px;
  border: var(--bn-border);
  border-radius: 4px;
  background: var(--bn-colors-menu-background);
  color: var(--bn-colors-editor-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  resize: vertical;
}

.nb-page-link {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 2px;
  border-radius: 4px;
  cursor: pointer;
}

.nb-page-link:hover {
  background-color: var(--bn-colors-hovered-background);
}

.nb-page-link-title {
  text-decoration: underline;
  text-decoration-color: var(--bn-colors-border);
  text-underline-offset: 3px;
  font-weight: 500;
}

.nb-page-link[data-missing] .nb-page-link-title {
  color: var(--bn-colors-highlights-gray-text);
}

.nb-raw {
  width: 100%;
  margin: 0;
  padding: 8px 12px;
  border-radius: 4px;
  background-color: var(--bn-colors-hovered-background);
  color: var(--bn-colors-highlights-gray-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85em;
  white-space: pre-wrap;
}

/* ---------- Notion look for built-in blocks ---------- */
.bn-root[data-color-scheme='light'] {
  --nb-code-bg: #f7f6f3;
  --nb-table-border: #e9e9e7;
  --nb-muted: rgba(55, 53, 47, 0.45);
}
.bn-root[data-color-scheme='dark'] {
  --nb-code-bg: #202020;
  --nb-table-border: rgba(255, 255, 255, 0.13);
  --nb-muted: rgba(255, 255, 255, 0.28);
}

.bn-root [data-content-type='heading'] {
  font-weight: 600;
}
.bn-root [data-content-type='heading'][data-level='1'] {
  --level: 1.875em;
}
.bn-root [data-content-type='heading'][data-level='2'] {
  --level: 1.5em;
}
.bn-root [data-content-type='heading'][data-level='3'] {
  --level: 1.25em;
}
.bn-root [data-content-type='heading'][data-level='4'],
.bn-root [data-content-type='heading'][data-level='5'],
.bn-root [data-content-type='heading'][data-level='6'] {
  --level: 1em;
}

.bn-root [data-content-type='quote'] blockquote {
  color: inherit;
  border-left: 3px solid currentColor;
  padding-left: 14px;
}

.bn-root .bn-block-content[data-content-type='codeBlock'] {
  background-color: var(--nb-code-bg);
  color: var(--bn-colors-editor-text);
  border-radius: 4px;
}
.bn-root .bn-block-content[data-content-type='codeBlock'] > pre {
  --bn-suggestion-surface: var(--nb-code-bg);
  padding: 32px 16px 32px 32px;
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 85%;
  line-height: 1.5;
}
.bn-root .bn-block-content[data-content-type='codeBlock'] > div > select {
  color: var(--nb-muted);
}
/* BlockNote always paints dark-theme token colours; light mode uses Shiki's light theme. */
.bn-root[data-color-scheme='light'] .shiki {
  color: var(--bn-suggestion-token-color, var(--shiki-light));
}

.bn-root .bn-editor [data-content-type='table'] th,
.bn-root .bn-editor [data-content-type='table'] td {
  border-color: var(--nb-table-border);
  padding: 7px 9px;
}

.bn-root [data-content-type='checkListItem'] input {
  accent-color: #2383e2;
}
.bn-root [data-content-type='checkListItem'][data-checked='true'] .bn-inline-content {
  color: var(--nb-muted);
  text-decoration-color: var(--nb-muted);
}
````

`src/renderer/src/editor/icon-picker.css`:

````css
.nb-icon-picker {
  display: flex;
  flex-direction: column;
  width: 408px;
  height: 356px;
  background: var(--bg);
  color: var(--text);
  isolation: isolate;
}

.nb-icon-picker-search {
  margin: 8px 8px 4px;
  padding: 4px 8px;
  height: 28px;
  border: 1px solid var(--divider);
  border-radius: 6px;
  background: var(--hover);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  outline: none;
  appearance: none;
}

.nb-icon-picker-search::-webkit-search-cancel-button {
  display: none;
}

.nb-icon-picker-search::placeholder {
  color: var(--text-secondary);
}

.nb-icon-picker-search:focus {
  border-color: var(--text-secondary);
}

.nb-icon-picker-viewport {
  flex: 1;
  outline: none;
}

.nb-icon-picker-list {
  padding: 0 8px 8px;
}

.nb-icon-picker-status {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 14px;
}

/* frimousse sizes rows and headers from their content box: no vertical padding or borders. */
.nb-icon-picker-category {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 4px;
  background: var(--bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.nb-icon-picker-row {
  scroll-margin-block: 30px 8px;
}

.nb-icon-picker-emoji {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.nb-icon-picker-emoji[data-active] {
  background: var(--hover);
}
````

- [ ] **Step 4: Run the tests and checks**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: 82 tests pass; no typecheck or lint output.

- [ ] **Step 5: Commit (ask Dale first)**

```bash
git add src/renderer/src/editor
git commit -m "Add Notion-style BlockNote editor module"
```

### Task 8: App UI and end-to-end tests

Puts it together: welcome screen, sidebar with nested pages, drag-to-reorder, inline rename, favorites, top bar with breadcrumbs and page menu, page cover/icon/title, the editor with autosave, and the menu shortcuts.
Driven by end-to-end tests that use the real app and check the Markdown files on disk.

**Files:**
- Create: `src/renderer/src/components/Welcome.tsx`, `Sidebar.tsx`, `SidebarRow.tsx`, `TopBar.tsx`, `PageTitle.tsx`, `PageHeader.tsx`, `PageEditor.tsx`, `PageView.tsx` (under `src/renderer/src/components/`), `src/renderer/src/App.tsx`
- Replace: `src/renderer/src/main.tsx`
- Test: `e2e/fixtures.ts`, `e2e/app.spec.ts`

**Interfaces:**
- Consumes: the store and lib (Task 6), the editor module (Task 7), `window.api` (Task 5).
- Produces: test ids `sidebar`, `sidebar-row-<title>`, `page-title`, `page-icon`, `page-cover`, `page-scroll`; accessible names `New page`, `Add a page inside`, `Page actions`, `Page menu`, `Add to Favorites` / `Remove from Favorites`, `Add icon`, `Add cover`, `Hide sidebar`, `Show sidebar`.
- Autosave: 500 ms after the last change, plus on page switch, before trashing, and on `app:flush`.
- New pages open with an empty, focused title showing an "Untitled" placeholder.
- If the last folder is missing, the welcome screen says so, shows the path, and offers "Locate folder"; window size and position are restored on launch.

- [ ] **Step 1: Write the failing end-to-end tests**


`e2e/fixtures.ts`:

````ts
import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface AppFixture {
  app: ElectronApplication
  page: Page
  workspace: string
  userData: string
  relaunch: () => Promise<Page>
}

export async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NOBSIDIAN_USER_DATA: userData, NODE_ENV: 'test' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** A running app with a fresh, empty workspace already open. */
export const test = base.extend<{ nb: AppFixture }>({
  nb: async ({}, use) => {
    const userData = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-user-'))
    const workspace = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-ws-'))
    await mkdir(userData, { recursive: true })
    await writeFile(join(userData, 'settings.json'), JSON.stringify({ lastWorkspace: workspace }))
    let { app, page } = await launch(userData)
    const fixture: AppFixture = {
      get app() {
        return app
      },
      get page() {
        return page
      },
      workspace,
      userData,
      relaunch: async () => {
        await app.close()
        ;({ app, page } = await launch(userData))
        return page
      }
    }
    await use(fixture)
    await app.close()
  }
})

export { expect } from '@playwright/test'
````

`e2e/app.spec.ts`:

````ts
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, type Page } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { expect, test } from './fixtures'

const editor = '.bn-editor'

/** Waits until the freshly created page is showing, so typing can't land in the previous one. */
async function typeNewPageTitle(page: Page, title: string): Promise<void> {
  const heading = page.getByTestId('page-title')
  await expect(heading).toHaveText('')
  await expect(heading).toBeFocused()
  await page.keyboard.type(title)
}

async function waitForFile(path: string, match: RegExp | string): Promise<string> {
  let text = ''
  await expect
    .poll(async () => {
      text = await readFile(path, 'utf8').catch(() => '')
      return typeof match === 'string' ? text.includes(match) : match.test(text)
    })
    .toBe(true)
  return text
}

test('first run asks for a folder and creates the first page', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-user-'))
  const folder = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-ws-'))
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page.getByText('Welcome to Nobsidian')).toBeVisible()
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [dir]
    })) as typeof dialog.showOpenDialog
  }, folder)
  await page.getByRole('button', { name: 'Choose a folder' }).click()
  await expect(page.getByTestId('sidebar-row-Untitled')).toBeVisible()
  expect(await readdir(folder)).toContain('Untitled.md')
  await app.close()
})

test('a missing notes folder is reported, not recreated', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-user-'))
  const gone = join(userData, 'Moved Notes')
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ lastWorkspace: gone }))
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page.getByText("Can't find your notes")).toBeVisible()
  await expect(page.getByText(gone)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Locate folder' })).toBeVisible()
  await expect(readdir(gone)).rejects.toThrow()
  await app.close()
})

test('remembers the window size', async ({ nb }) => {
  await nb.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 60, width: 1000, height: 700 })
  )
  await nb.relaunch()
  const bounds = await nb.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  )
  expect(bounds).toMatchObject({ width: 1000, height: 700 })
})

test('writing a page saves Markdown to disk', async ({ nb }) => {
  const { page, workspace } = nb
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Meeting notes')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('sidebar-row-Meeting notes')).toBeVisible()
  await page.keyboard.type('# Agenda')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- first item')
  await page.keyboard.press('Enter')
  await page.keyboard.type('second item')
  const text = await waitForFile(join(workspace, 'Meeting notes.md'), 'second item')
  expect(text).toMatch(/# Agenda\n\n- first item\n- second item\n/)
})

test('slash menu inserts a callout and a sub-page', async ({ nb }) => {
  const { page, workspace } = nb
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Parent')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/callout')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Remember this')
  await waitForFile(join(workspace, 'Parent.md'), '> [!callout] 💡\n> Remember this')
  await page.locator(editor).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/page')
  await page.keyboard.press('Enter')
  await waitForFile(join(workspace, 'Parent.md'), '(Parent/Untitled.md "page")')
  await expect(page.locator('.nb-page-link')).toHaveText(/Untitled/)
  await page.locator('.nb-page-link').click()
  await expect(page.locator('.breadcrumbs')).toHaveText(/Parent\s*\/\s*Untitled/)
})

test('renaming a parent moves its folder and keeps links working', async ({ nb }) => {
  const { page, workspace } = nb
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Projects')
  await page.getByTestId('sidebar-row-Projects').hover()
  await page
    .getByTestId('sidebar-row-Projects')
    .getByRole('button', { name: 'Add a page inside' })
    .click()
  await typeNewPageTitle(page, 'Website')
  await expect(page.getByTestId('sidebar-row-Website')).toBeVisible()
  await expect
    .poll(() => readdir(join(workspace, 'Projects')).catch(() => []))
    .toEqual(['Website.md'])
  await page.getByTestId('sidebar-row-Projects').click()
  await page.getByTestId('page-title').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 2026')
  await expect(page.getByTestId('sidebar-row-Projects 2026')).toBeVisible()
  await expect
    .poll(() => readdir(join(workspace, 'Projects 2026')).catch(() => []))
    .toEqual(['Website.md'])
})

test('favorites, delete and dark mode', async ({ nb }) => {
  const { page, workspace } = nb
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Keep')
  await page.getByRole('button', { name: 'Add to Favorites' }).click()
  await expect(page.locator('.sidebar-section-title', { hasText: 'Favorites' })).toBeVisible()
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Remove me')
  await expect(page.getByTestId('sidebar-row-Remove me')).toBeVisible()
  await page.getByRole('button', { name: 'Page menu' }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('sidebar-row-Remove me')).toHaveCount(0)
  expect(await readdir(join(workspace, '.nobsidian', 'trash'))).toHaveLength(1)

  await nb.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById?.('x')
    const item = Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Toggle Dark Mode')
    item?.click()
  })
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/)
  const before = await page.locator('html').getAttribute('data-theme')
  await nb.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Toggle Dark Mode')
      ?.click()
  })
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '')
})

test('edits survive a restart, including the last open page', async ({ nb }) => {
  let page = nb.page
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Journal')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Dear diary')
  page = await nb.relaunch()
  await expect(page.getByTestId('page-title')).toHaveText('Journal')
  await expect(page.locator(editor)).toContainText('Dear diary')
})

test('page icon from the emoji picker and an uploaded cover', async ({ nb }) => {
  const { page, workspace, app } = nb
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Trip')
  await page.getByTestId('page-title').hover()
  await page.getByRole('button', { name: 'Add icon' }).click()
  await page.getByTestId('page-icon').click()
  await page.getByPlaceholder('Filter…').fill('airplane')
  await page.locator('.nb-icon-picker-emoji', { hasText: '✈️' }).click()
  await expect(page.getByTestId('page-icon')).toHaveText('✈️')
  await waitForFile(join(workspace, 'Trip.md'), 'icon: ✈️')

  const image = join(workspace, '..', `cover-${Date.now()}.png`)
  await writeFile(
    image,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [file]
    })) as typeof dialog.showOpenDialog
  }, image)
  await page.getByTestId('page-title').hover()
  await page.getByRole('button', { name: 'Add cover' }).click()
  await expect(page.getByTestId('page-cover').locator('img')).toHaveJSProperty('naturalWidth', 1)
  await waitForFile(join(workspace, 'Trip.md'), /cover: attachments\/cover-\d+\.png/)
})
````

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test:e2e`
Expected: the smoke test passes; the 9 tests in `app.spec.ts` FAIL (for example "Welcome to Nobsidian" is not visible), because the renderer is still the skeleton.

- [ ] **Step 3: Write the implementation**


`src/renderer/src/components/Welcome.tsx`:

````tsx
import { useApp } from '../store'

export function Welcome(): React.JSX.Element {
  const missing = useApp((s) => s.settings?.lastWorkspace)
  return (
    <div className="main drag-region">
      <div className="welcome no-drag">
        {missing ? (
          <>
            <h1>Can&apos;t find your notes</h1>
            <p>
              Nobsidian couldn&apos;t find the folder <strong>{missing}</strong>. It may have been
              moved, renamed, or be on a drive that isn&apos;t connected.
            </p>
          </>
        ) : (
          <>
            <h1>Welcome to Nobsidian</h1>
            <p>
              Your notes live as Markdown files in a folder you choose. Pick an empty folder to
              start fresh, or one that already has notes.
            </p>
          </>
        )}
        <button className="button-primary" onClick={() => void useApp.getState().chooseWorkspace()}>
          {missing ? 'Locate folder' : 'Choose a folder'}
        </button>
      </div>
    </div>
  )
}
````

`src/renderer/src/components/Sidebar.tsx`:

````tsx
import { useState } from 'react'
import { findNode } from '../lib/tree'
import { useApp } from '../store'
import { ComposeIcon, PlusIcon, SidebarIcon } from './icons'
import { Menu } from './Popover'
import { SidebarRow } from './SidebarRow'

const MIN_WIDTH = 200
const MAX_WIDTH = 480

export function Sidebar(): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const favorites = useApp((s) => s.favorites)
  const workspace = useApp((s) => s.workspace)
  const savedWidth = useApp((s) => s.settings?.sidebarWidth ?? 240)
  const [width, setWidth] = useState<number | null>(null)
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const app = useApp.getState

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const start = savedWidth
    let latest = start
    const move = (ev: MouseEvent): void => {
      latest = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, start + ev.clientX - startX))
      setWidth(latest)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void app()
        .updateSettings({ sidebarWidth: latest })
        .then(() => setWidth(null))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const favoriteNodes = favorites.map((id) => findNode(tree, id)).filter((n) => n !== null)

  return (
    <aside className="sidebar" style={{ width: width ?? savedWidth }} data-testid="sidebar">
      <div className="sidebar-header drag-region">
        <button
          className="icon-button no-drag"
          aria-label="Hide sidebar"
          onClick={() => void app().updateSettings({ sidebarCollapsed: true })}
        >
          <SidebarIcon size={16} />
        </button>
        <button
          className="icon-button no-drag"
          aria-label="New page"
          onClick={() => void app().createPage(null)}
        >
          <ComposeIcon size={16} />
        </button>
      </div>
      <button
        className="sidebar-workspace"
        onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
      >
        <span className="sidebar-workspace-badge">{workspace?.name.slice(0, 1).toUpperCase()}</span>
        <span className="sidebar-row-title">{workspace?.name}</span>
      </button>
      <div className="sidebar-scroll">
        {favoriteNodes.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Favorites</div>
            {favoriteNodes.map((node) => (
              <SidebarRow
                key={node.id}
                node={node}
                depth={0}
                draggable={false}
                expandable={false}
              />
            ))}
          </div>
        )}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Pages</div>
          {tree.map((node) => (
            <SidebarRow key={node.id} node={node} depth={0} />
          ))}
          <button className="sidebar-row sidebar-add" onClick={() => void app().createPage(null)}>
            <span className="page-icon">
              <PlusIcon size={16} />
            </span>
            <span className="sidebar-row-title">New page</span>
          </button>
        </div>
      </div>
      <div className="sidebar-resize" onMouseDown={startResize} />
      {menu && (
        <Menu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[{ label: 'Open another folder…', onSelect: () => void app().chooseWorkspace() }]}
        />
      )}
    </aside>
  )
}
````

`src/renderer/src/components/SidebarRow.tsx`:

````tsx
import { useState, type DragEvent } from 'react'
import type { PageNode } from '@shared/types'
import { dropTarget, type DropPosition } from '../lib/tree'
import { useApp } from '../store'
import { ChevronRightIcon, DotsIcon, PlusIcon, StarIcon, TrashIcon } from './icons'
import { Menu } from './Popover'
import { PageIconView } from './PageIconView'

const DRAG_TYPE = 'application/x-nobsidian-page'
// Selectors must return stable references, or zustand re-renders forever.
const NONE: string[] = []

export function SidebarRow({
  node,
  depth,
  draggable = true,
  expandable = true
}: {
  node: PageNode
  depth: number
  draggable?: boolean
  expandable?: boolean
}): React.JSX.Element {
  const currentId = useApp((s) => s.currentId)
  const expandedIds = useApp((s) => (s.workspace && s.settings?.expanded[s.workspace.root]) || NONE)
  const favorites = useApp((s) => s.favorites)
  const renamingId = useApp((s) => s.renamingId)
  const app = useApp.getState
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const [drop, setDrop] = useState<DropPosition | null>(null)

  const expanded = expandable && expandedIds.includes(node.id)
  const isFavorite = favorites.includes(node.id)
  const indent = 6 + depth * 14

  const positionFor = (e: DragEvent<HTMLDivElement>): DropPosition => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    if (y < rect.height * 0.25) return 'before'
    if (y > rect.height * 0.75) return 'after'
    return 'inside'
  }

  return (
    <>
      <div
        className={[
          'sidebar-row',
          currentId === node.id ? 'active' : '',
          menu ? 'menu-open' : '',
          drop ? `drop-${drop}` : ''
        ].join(' ')}
        style={{ paddingLeft: indent }}
        data-testid={`sidebar-row-${node.title || 'Untitled'}`}
        draggable={draggable && renamingId !== node.id}
        onClick={() => app().openPage(node.id)}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, node.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          if (!draggable || !e.dataTransfer.types.includes(DRAG_TYPE)) return
          e.preventDefault()
          setDrop(positionFor(e))
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault()
          setDrop(null)
          const dragged = e.dataTransfer.getData(DRAG_TYPE)
          const target = dragged && dropTarget(app().tree, dragged, node.id, positionFor(e))
          if (target) void app().movePage(dragged, target.parentId, target.index)
        }}
      >
        {/* Like Notion, the page icon turns into the expand arrow on hover. */}
        <span className={`sidebar-row-lead ${expandable ? 'expandable' : ''}`}>
          <span className="page-icon">
            <PageIconView icon={node.icon} />
          </span>
          {expandable && (
            <button
              className="icon-button sidebar-row-toggle"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              onClick={(e) => {
                e.stopPropagation()
                void app().setExpanded(node.id, !expanded)
              }}
            >
              <ChevronRightIcon size={12} className={`toggle-arrow ${expanded ? 'open' : ''}`} />
            </button>
          )}
        </span>
        {renamingId === node.id ? (
          <RenameInput node={node} />
        ) : (
          <span className="sidebar-row-title">{node.title || 'Untitled'}</span>
        )}
        <span className="sidebar-row-actions">
          <button
            className="icon-button"
            aria-label="Page actions"
            onClick={(e) => {
              e.stopPropagation()
              setMenu(e.currentTarget.getBoundingClientRect())
            }}
          >
            <DotsIcon size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Add a page inside"
            onClick={(e) => {
              e.stopPropagation()
              void app().createPage(node.id)
            }}
          >
            <PlusIcon size={14} />
          </button>
        </span>
      </div>
      {menu && (
        <Menu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            {
              label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
              icon: <StarIcon size={16} filled={isFavorite} />,
              onSelect: () => void app().toggleFavorite(node.id)
            },
            { label: 'Rename', onSelect: () => app().setRenaming(node.id) },
            'separator',
            {
              label: 'Delete',
              icon: <TrashIcon size={16} />,
              danger: true,
              onSelect: () => void app().trashPage(node.id)
            }
          ]}
        />
      )}
      {expanded &&
        (node.children.length ? (
          node.children.map((child) => <SidebarRow key={child.id} node={child} depth={depth + 1} />)
        ) : (
          <div className="sidebar-empty" style={{ paddingLeft: indent + 14 + 28 }}>
            No pages inside
          </div>
        ))}
    </>
  )
}

function RenameInput({ node }: { node: PageNode }): React.JSX.Element {
  const [value, setValue] = useState(node.title)
  const done = (commit: boolean): void => {
    useApp.getState().setRenaming(null)
    if (commit && value !== node.title) void useApp.getState().renamePage(node.id, value)
  }
  return (
    <input
      className="rename-input"
      autoFocus
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(true)
        if (e.key === 'Escape') done(false)
      }}
    />
  )
}
````

`src/renderer/src/components/TopBar.tsx`:

````tsx
import { Fragment, useState } from 'react'
import type { PageDoc } from '@shared/types'
import { pathTo } from '../lib/tree'
import { useApp } from '../store'
import { DotsIcon, SidebarIcon, StarIcon, TrashIcon } from './icons'
import { Menu } from './Popover'
import { PageIconView } from './PageIconView'

export function TopBar({
  doc,
  onToggleFullWidth
}: {
  doc: PageDoc | null
  onToggleFullWidth: () => void
}): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const favorites = useApp((s) => s.favorites)
  const collapsed = useApp((s) => s.settings?.sidebarCollapsed ?? false)
  const currentId = useApp((s) => s.currentId)
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const app = useApp.getState
  const crumbs = currentId ? pathTo(tree, currentId) : []
  const isFavorite = currentId ? favorites.includes(currentId) : false

  return (
    <header className={`topbar drag-region ${collapsed ? 'sidebar-hidden' : ''}`}>
      <div className="breadcrumbs no-drag">
        {collapsed && (
          <button
            className="icon-button"
            aria-label="Show sidebar"
            onClick={() => void app().updateSettings({ sidebarCollapsed: false })}
          >
            <SidebarIcon size={16} />
          </button>
        )}
        {crumbs.map((node, i) => (
          <Fragment key={node.id}>
            {i > 0 && <span className="breadcrumb-sep">/</span>}
            <button className="breadcrumb" onClick={() => app().openPage(node.id)}>
              {node.icon && (
                <span className="page-icon">
                  <PageIconView icon={node.icon} size={14} />
                </span>
              )}
              {node.title || 'Untitled'}
            </button>
          </Fragment>
        ))}
      </div>
      {currentId && (
        <div className="topbar-actions no-drag">
          <button
            className={`icon-button ${isFavorite ? 'on' : ''}`}
            aria-label={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
            onClick={() => void app().toggleFavorite(currentId)}
          >
            <StarIcon size={17} filled={isFavorite} />
          </button>
          <button
            className="icon-button"
            aria-label="Page menu"
            onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
          >
            <DotsIcon size={17} />
          </button>
        </div>
      )}
      {menu && currentId && (
        <Menu
          anchor={menu}
          align="end"
          onClose={() => setMenu(null)}
          items={[
            {
              label: doc?.meta.fullWidth ? 'Use default width' : 'Full width',
              onSelect: onToggleFullWidth
            },
            'separator',
            {
              label: 'Delete',
              icon: <TrashIcon size={16} />,
              danger: true,
              onSelect: () => void app().trashPage(currentId)
            }
          ]}
        />
      )}
    </header>
  )
}
````

`src/renderer/src/components/PageTitle.tsx`:

````tsx
import { useEffect, useRef } from 'react'
import { useApp } from '../store'

const RENAME_DELAY_MS = 400

/** Big editable title; renames the page file shortly after typing stops. */
export function PageTitle({
  id,
  title,
  onEnter
}: {
  id: string
  title: string
  onEnter: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLHeadingElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(title)

  useEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.textContent !== title) el.textContent = title
    latest.current = title
  }, [title])

  // A brand-new page starts with the cursor in its title, like Notion.
  useEffect(() => {
    if (latest.current === '') ref.current?.focus()
  }, [id])

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        void useApp.getState().renamePage(id, latest.current)
      }
    },
    [id]
  )

  const commit = (): void => {
    timer.current = null
    void useApp.getState().renamePage(id, latest.current)
  }

  return (
    <h1
      ref={ref}
      className="page-title"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      data-placeholder="Untitled"
      data-testid="page-title"
      onInput={(e) => {
        latest.current = (e.currentTarget.textContent ?? '').replace(/\n/g, ' ')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(commit, RENAME_DELAY_MS)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (timer.current) {
            clearTimeout(timer.current)
            commit()
          }
          onEnter()
        }
      }}
    />
  )
}
````

`src/renderer/src/components/PageHeader.tsx`:

````tsx
import { useState } from 'react'
import type { PageMetaPatch } from '@shared/types'
import type { PageMeta } from '@shared/core/page'
import { resolveAssetUrl } from '../lib/assets'
import { ImageIcon, SmileIcon } from './icons'
import { IconPicker } from '../editor/IconPicker'
import { Popover } from './Popover'

const api = window.api
const STARTER_ICONS = ['📄', '📝', '💡', '🚀', '📚', '🌱', '🎯', '🗂️', '✨', '🧭']

export function PageCover({
  meta,
  onChange
}: {
  meta: PageMeta
  onChange: (patch: PageMetaPatch) => void
}): React.JSX.Element | null {
  const [position, setPosition] = useState<number | null>(null)
  if (!meta.cover) return null
  const current = position ?? meta.coverPosition ?? 50

  const startDrag = (e: React.MouseEvent<HTMLImageElement>): void => {
    if (position === null) return
    e.preventDefault()
    const startY = e.clientY
    const start = current
    const height = e.currentTarget.getBoundingClientRect().height
    const move = (ev: MouseEvent): void =>
      setPosition(Math.max(0, Math.min(100, start - ((ev.clientY - startY) / height) * 100)))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="page-cover" data-testid="page-cover">
      <img
        src={resolveAssetUrl(meta.cover)}
        alt=""
        draggable={false}
        style={{
          objectPosition: `center ${current}%`,
          cursor: position === null ? 'default' : 'move'
        }}
        onMouseDown={startDrag}
      />
      <div
        className="page-cover-actions"
        style={position === null ? undefined : { display: 'flex' }}
      >
        {position === null ? (
          <>
            <button
              className="cover-button"
              onClick={async () => {
                const cover = await api.invoke('attachment:chooseImage', undefined)
                if (cover) onChange({ cover, coverPosition: 50 })
              }}
            >
              Change cover
            </button>
            <button className="cover-button" onClick={() => setPosition(current)}>
              Reposition
            </button>
            <button
              className="cover-button"
              onClick={() => onChange({ cover: null, coverPosition: null })}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <button
              className="cover-button"
              onClick={() => {
                onChange({ coverPosition: Math.round(current) })
                setPosition(null)
              }}
            >
              Save position
            </button>
            <button className="cover-button" onClick={() => setPosition(null)}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function PageIconAndControls({
  meta,
  onChange
}: {
  meta: PageMeta
  onChange: (patch: PageMetaPatch) => void
}): React.JSX.Element {
  const [picker, setPicker] = useState<DOMRect | null>(null)

  const chooseCover = async (): Promise<void> => {
    const cover = await api.invoke('attachment:chooseImage', undefined)
    if (cover) onChange({ cover, coverPosition: 50 })
  }

  return (
    <>
      {meta.icon && (
        <button
          className="page-header-icon"
          aria-label="Change icon"
          data-testid="page-icon"
          onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
        >
          {meta.icon.startsWith('/') ? <img src={resolveAssetUrl(meta.icon)} alt="" /> : meta.icon}
        </button>
      )}
      <div className="page-header-controls">
        {!meta.icon && (
          <button
            className="page-header-control"
            onClick={() =>
              onChange({ icon: STARTER_ICONS[Math.floor(Math.random() * STARTER_ICONS.length)] })
            }
          >
            <SmileIcon size={16} /> Add icon
          </button>
        )}
        {!meta.cover && (
          <button className="page-header-control" onClick={() => void chooseCover()}>
            <ImageIcon size={16} /> Add cover
          </button>
        )}
      </div>
      {picker && (
        <Popover anchor={picker} onClose={() => setPicker(null)} className="icon-picker">
          <div className="icon-picker-bar">
            <button
              className="page-header-control"
              onClick={async () => {
                const icon = await api.invoke('attachment:chooseImage', undefined)
                if (icon) onChange({ icon })
                setPicker(null)
              }}
            >
              Upload
            </button>
            <button
              className="page-header-control"
              onClick={() => {
                onChange({ icon: null })
                setPicker(null)
              }}
            >
              Remove
            </button>
          </div>
          <IconPicker
            onSelect={(emoji) => {
              onChange({ icon: emoji })
              setPicker(null)
            }}
          />
        </Popover>
      )}
    </>
  )
}
````

`src/renderer/src/components/PageEditor.tsx`:

````tsx
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Block } from '@shared/core/blocks'
import { pageIdFromHref, pageLinkHref } from '@shared/core/links'
import { openHref } from '../lib/navigation'
import type { PageDoc } from '@shared/types'
import { codeBlockOptions } from '@blocknote/code-block'
import { Editor } from '../editor/Editor'
import { createLanguageResolver, withEditorLanguages } from '../editor/codeLanguages'
import type { AppBlock, AppPartialBlock, PageLinkContextValue } from '../editor/schema'
import { resolveAssetUrl } from '../lib/assets'
import { findNode } from '../lib/tree'
import { registerFlusher, useApp } from '../store'

const SAVE_DELAY_MS = 500
const editorLanguage = createLanguageResolver(codeBlockOptions.supportedLanguages)
const api = window.api

export function PageEditor({
  doc,
  theme
}: {
  doc: PageDoc
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const pending = useRef<Block[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tree = useApp((s) => s.tree)

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const blocks = pending.current
    pending.current = null
    if (blocks) await api.invoke('page:write', { id: doc.id, blocks })
  }, [doc.id])

  useEffect(() => {
    const unregister = registerFlusher(flush)
    return () => {
      unregister()
      void flush()
    }
  }, [flush])

  const onChange = useCallback(
    (blocks: AppBlock[]) => {
      pending.current = blocks as unknown as Block[]
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush]
  )

  const initialBlocks = useMemo(
    () => withEditorLanguages(doc.blocks, editorLanguage) as unknown as AppPartialBlock[],
    [doc.blocks]
  )

  const pageLink = useMemo<PageLinkContextValue>(
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
        await flush()
        const node = await api.invoke('page:create', { parentId: doc.id })
        void useApp.getState().setExpanded(doc.id, true)
        return pageLinkHref(node.id)
      }}
      openLink={openHref}
      pageLink={pageLink}
    />
  )
}
````

`src/renderer/src/components/PageView.tsx`:

````tsx
import { useEffect, useRef, useState } from 'react'
import type { PageDoc, PageMetaPatch } from '@shared/types'
import { findNode } from '../lib/tree'
import { useApp } from '../store'
import { PageCover, PageIconAndControls } from './PageHeader'
import { PageEditor } from './PageEditor'
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
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!currentId) return
    let cancelled = false
    void api.invoke('page:read', { id: currentId }).then((d) => {
      if (!cancelled) setDoc(d)
    })
    return () => {
      cancelled = true
    }
  }, [currentId])

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
      <div className="page-scroll" data-testid="page-scroll">
        {ready && (
          <>
            <PageCover meta={doc.meta} onChange={updateMeta} />
            <div className={`page-column ${doc.meta.fullWidth ? 'full-width' : ''}`}>
              <div className={`page-header ${doc.meta.cover ? 'has-cover' : ''}`}>
                <PageIconAndControls meta={doc.meta} onChange={updateMeta} />
                <PageTitle
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
              <PageEditor key={doc.id} doc={doc} theme={theme} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
````

`src/renderer/src/App.tsx`:

````tsx
import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { PageView } from './components/PageView'
import { Welcome } from './components/Welcome'
import { toggledPreference, useEffectiveTheme } from './lib/theme'
import { flushAll, useApp } from './store'

const api = window.api

export function App(): React.JSX.Element | null {
  const ready = useApp((s) => s.ready)
  const workspace = useApp((s) => s.workspace)
  const settings = useApp((s) => s.settings)
  const theme = useEffectiveTheme(settings?.theme)

  useEffect(() => {
    void useApp.getState().init()
    const offTree = api.on('tree:changed', (snapshot) => useApp.getState().applySnapshot(snapshot))
    const offFlush = api.on('app:flush', () => {
      void flushAll().finally(() => api.invoke('app:flushed', undefined))
    })
    return () => {
      offTree()
      offFlush()
    }
  }, [])

  useEffect(
    () =>
      api.on('menu:command', (cmd) => {
        const app = useApp.getState()
        if (cmd === 'new-page') void app.createPage(null)
        if (cmd === 'back') app.back()
        if (cmd === 'forward') app.forward()
        if (cmd === 'toggle-sidebar')
          void app.updateSettings({ sidebarCollapsed: !app.settings?.sidebarCollapsed })
        if (cmd === 'toggle-theme') void app.updateSettings({ theme: toggledPreference(theme) })
      }),
    [theme]
  )

  if (!ready) return null
  return (
    <div className="app">
      {!workspace ? (
        <Welcome />
      ) : (
        <>
          {!settings?.sidebarCollapsed && <Sidebar />}
          <PageView theme={theme} />
        </>
      )}
    </div>
  )
}
````

`src/renderer/src/main.tsx`:

````tsx
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
````

- [ ] **Step 4: Run all checks and tests**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: no typecheck or lint output; 82 unit tests pass; 10 end-to-end tests pass (smoke + 9).

- [ ] **Step 5: Prove the suite is not flaky**

Run: `pnpm exec playwright test --repeat-each=10`
Expected: `100 passed`.
If anything fails, open the trace (`pnpm exec playwright show-trace test-results/<test>/trace.zip`), find the root cause and fix it in the app or the test's waiting logic; never add retries.

- [ ] **Step 6: Try it by hand**

Run: `pnpm dev`, choose an empty folder, and check: create nested pages, type `/` for the slash menu, drag a sidebar row onto another page, rename from the `···` menu, add an icon and a cover, toggle dark mode with Cmd+Shift+L, hide the sidebar with Cmd+\, go back with Cmd+[.
Open the folder in Finder and confirm the `.md` files and subfolders mirror the sidebar.

- [ ] **Step 7: Commit (ask Dale first)**

```bash
git add src/renderer/src e2e
git commit -m "Add sidebar, page view and editor UI with end-to-end tests"
```

### Task 9: Visual parity pass and packaging

Holds the app to the spec's success criteria: side by side with Notion it should look the same, and it should install as a normal Mac app.

**Files:**
- Modify (only where the comparison finds differences): `src/renderer/src/styles/app.css`, `src/renderer/src/editor/editor.css`
- Create: `e2e/screenshots.spec.ts`

**Interfaces:**
- Consumes: the whole app.
- Produces: `dist/nobsidian-0.1.0-arm64.dmg`; light and dark reference screenshots under `test-results/`.

- [ ] **Step 1: Write the screenshot script**

`e2e/screenshots.spec.ts`:

````ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'

const SAMPLE = `---
id: 11111111-1111-4111-8111-111111111111
icon: 🚀
---

Plan the **website redesign** with *clear* goals and a <span data-bg="yellow">highlighted</span> note.

## Goals

- [x] Audit the current site
- [ ] Draft the new structure
- Ship a <span data-color="red">faster</span> homepage

> [!callout] 💡
> Remember to involve design early.

<details>
<summary>Open questions</summary>

1. Which CMS?

</details>

| Phase | Owner |
| - | - |
| Research | Dale |

\`\`\`ts
const launch = new Date('2027-01-15')
\`\`\`

> Simplicity is the ultimate sophistication.
`

test('reference screenshots in light and dark', async ({ nb }) => {
  await mkdir(join(nb.workspace, 'Website Redesign'), { recursive: true })
  await writeFile(join(nb.workspace, 'Website Redesign.md'), SAMPLE)
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Website Redesign').click()
  await expect(page.locator('.bn-editor')).toContainText('Simplicity')
  await page.screenshot({ path: 'test-results/reference-light.png' })
  await nb.app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Toggle Dark Mode')
      ?.click()
  )
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'test-results/reference-dark.png' })
})
````

- [ ] **Step 2: Capture and compare with Notion**

Run: `pnpm test:e2e e2e/screenshots.spec.ts`, then build the same page in Notion (light and dark) and compare side by side at the same window size.
Check, at minimum: sidebar row height, indent and hover state; page title size and spacing; heading sizes (30/24/20 px); body text 16 px with 1.5 line height; callout padding and colors; quote bar; code block background; table borders; checkbox color; slash menu density; dark palette.

- [ ] **Step 3: Fix the known deviation and anything else found**

Known from the prototype: tables render about 14 px to the right of the text column.
Find the padding source in DevTools (`pnpm dev`, View > Toggle Developer Tools, inspect `.tableWrapper`) and zero it with a rule in `editor.css` scoped under `.bn-root`.
Fix every other deviation the comparison finds the same way (tokens in `tokens.css`, layout in `app.css`, editor blocks in `editor.css`), re-capture, and repeat until they match.

- [ ] **Step 4: Re-run everything**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`
Expected: all green.

- [ ] **Step 5: Build the installer**

Run: `pnpm build:mac`
Expected: `dist/nobsidian-0.1.0-arm64.dmg`; the log says code signing was skipped.
Open the dmg, drag Nobsidian to Applications, right-click > Open, and confirm it launches to the welcome screen.

- [ ] **Step 6: Commit (ask Dale first)**

```bash
git add -A
git commit -m "Match Notion's look and add the screenshot check"
```
