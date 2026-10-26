# Nobsidian - AI Writer Design Spec

Date: 2026-10-26
Status: Approved; updated with what the prototype taught

## 1. Purpose

Nobsidian deferred AI in version one.
The core app, search, history, Notion import, drawings and tabs are now merged, so AI comes next.
The owner mostly wants help writing in the page they are on: improve, shorten, lengthen, proofread, continue, translate and summarize.
The feature is designed for anyone who installs the open-source app and brings their own Anthropic API key.
Notion parity is the yardstick.

### What Notion does

Notion's help pages now describe the Agent chat but not the inline flow, so the facts below come from Notion's web client code dated 2026-10-25, read from the Notion desktop app's cache on 2026-10-26.

- The inline AI is an agent called "Writer" that edits the page directly.
- Its prompt is a popup, at least 350px wide with a 12px radius, whose input reads "Edit with AI".
- The selection toolbar starts with an "Ask AI" button, tooltip "Ask AI to help edit, review, or generate text." and ⌘J.
- Space on an empty text-like line opens the Writer when AI is enabled and the client is online.
- Empty lines then read "Press ‘space’ for AI or ‘/’ for commands".
- Default skills are Improve writing, Proofread, Explain and Reformat; "Change tone" and "Translate to" take free text.
- Edits stream straight into the page as a diff.
- While it runs the popup shows only a square Stop button; Esc and clicks outside are ignored.
- After it runs the popup shows Undo (⌘Z) and a blue Accept (Enter); there is no Try again and no discard dialog.
- Closing the popup without undoing keeps the edit, and ⌘Z still reverts it afterwards.
- An answer that makes no edit shows in the popup with "Insert below".
- Offline, AI entry points are disabled with "AI is unavailable offline".
- Notion shows no AI disclaimer; its AI is bundled into paid plans.

### Success criteria

- Selecting a paragraph and choosing Make shorter shows the change streaming into the page as a diff within about two seconds on Opus 5.5.
- Accept, Undo, Stop, Enter, ⌘Z and clicking outside behave as in section 5.
- Nothing the AI writes reaches the Markdown file, history or another tab until it is accepted.
- The API key never appears in `settings.json`, the notes folder, logs or the renderer.
- The monthly cost in Settings matches the token counts Anthropic reports.
- All flows are covered by e2e tests against a fake Anthropic server.

### Out of scope

Asking questions about the workspace, turning pages into to-dos or tables, AI blocks, skills the user writes, a chat panel, ranking skills by use, other providers, and a spending cap inside the app.

## 2. Decisions

| Topic | Decision |
|---|---|
| Scope | Writing help in the current page only. |
| Audience | Anyone with their own Anthropic API key. |
| Provider | Claude through the official `@anthropic-ai/sdk`, called from the main process. |
| Default model | `claude-opus-5-5` at effort `low`; Sonnet 5.5 and Haiku 5.5 in Settings. |
| Key storage | Encrypted with Electron `safeStorage` in its own file in the app's data folder. |
| Context | The current page as Markdown with the selection marked; never other pages, images, files or drawings. |
| Placement | Notion's current Writer: in-place diff with Accept and Undo. |
| Cost | A monthly total in Settings, computed from reported usage; nothing in the editor. |
| Entry points | "Ask AI" in the toolbar, ⌘J, `/ai`, and Space on an empty line. |
| E2E | A fake Anthropic HTTP server that speaks the real streaming protocol. |

## 3. Entry points

- **Toolbar.** "Ask AI" is the first item of the formatting toolbar, with a sparkle icon and the tooltip "Ask AI to help edit, review, or generate text." plus ⌘J.
- **⌘J.** Opens the Writer on the selection, or at the cursor when nothing is selected.
- **Slash menu.** An "AI" group at the end holds one item, "Ask AI", matched by `ai`, `ask`, `write` and `claude`; it is last so Text stays first, as in Notion.
- **Space.** In an empty paragraph, heading or list item, Space with no modifier opens the Writer.
  It does nothing special in code blocks, tables, or while an input method is composing.
- **Hint.** When AI is available, empty paragraphs show "Press ‘space’ for AI or ‘/’ for commands"; otherwise Notion's "Press ‘/’ for commands…" replaces BlockNote's default.
- **Available** means: AI is shown in Settings, a key is saved, and `navigator.onLine` is true.
- **No key.** Every entry point except Space opens the setup card (section 8.3).
  Space types a space.
- **Offline.** The toolbar button and slash item are greyed out with the tooltip "AI is unavailable offline"; ⌘J does nothing; Space types a space.
- **Hidden.** With "Show AI in the editor" off, none of the entry points or the hint exist.

## 4. The Writer popup

The popup sits below the selection or the cursor block, in the editor's own layer, 400px wide (narrower when the page column is), with a 12px radius and the app's menu shadow.
It uses the existing menus kit for its list and keyboard handling.

### 4.1 Prompt

- An input with a sparkle icon and the placeholder "Edit with AI".
- A send button on the right, enabled when the input has text.
- While the input is empty, a **Skills** list sits below it.
- Typing filters the list with the menus kit's `filterEntries`.
- Enter runs the highlighted skill, or sends the typed text as the instruction when no skill matches.
- Esc, or Backspace in an empty input, closes the popup.

### 4.2 Skills

With a selection:

| Skill | Kind | Instruction |
|---|---|---|
| Improve writing | edit | Clearer and tighter, same meaning, language and formatting. |
| Proofread | edit | Fix spelling, grammar and punctuation only. |
| Make shorter | edit | About half the length, keeping every key point. |
| Make longer | edit | Expand with detail that follows from the page; invent no facts. |
| Simplify language | edit | Plain words and short sentences. |
| Change tone to… | edit | Fills the input with "Change tone to " for the user to finish. |
| Translate to… | edit | Fills the input with "Translate to " for the user to finish. |
| Summarize | insert below | A short summary of the selection, inserted after it. |
| Explain | reply | Explains the selection in the popup. |

On an empty line or a cursor with no selection:

| Skill | Kind | Instruction |
|---|---|---|
| Continue writing | insert at cursor | Continues from the cursor in the page's voice. |
| Summarize page | insert at cursor | A short summary of the whole page. |
| Translate page to… | edit page | Fills the input with "Translate page to "; the whole page body is the target. |

Typed instructions are free text.
With a selection Claude may edit it or reply; without one it may insert at the cursor or reply (section 6.3).

### 4.3 States

| State | Popup shows | Keys |
|---|---|---|
| Prompt | Input and Skills | Enter sends, Esc closes |
| Writing | "Writing…" in a read-only input, and a square Stop button | Esc and clicks outside are ignored |
| Review | Input reading "Edit with AI", Undo ⌘Z, blue Accept ↵ | Enter accepts, ⌘Z undoes, Esc is ignored, typing then Enter sends a follow-up |
| Reply | The answer, rendered as Markdown, and "Insert below" | Esc or clicking outside closes |
| Error | One red line (section 9), plus Undo and Accept when a partial change exists | As Review |

A follow-up typed in Review revises the pending change: the conversation so far is sent again with the follow-up, and the new result replaces the pending change.

## 5. How changes land

### 5.1 Pending change

- A pending change is held by a new editor plugin, `aiPending`, as two ranges: the original content and the new content.
- The original content stays in the document, decorated as removed: struck through, in red text with a light red background.
- The new content is real document content right after it, decorated as added: a light blue background.
- Inserts have only new content.
- Stream steps are applied with `addToHistory: false`, so they never enter undo history.
- Each render deletes the previous result and inserts the new one, so positions never drift and the undo history from before the Writer survives; replacing the whole document would wipe it.
- Nothing is decorated until the first text arrives.
- While a change is pending the page is read-only.
- The text selection is kept as a highlight while the Writer is open, and the caret collapses, so the formatting toolbar gets out of the way.

### 5.2 Targets

- **Inline.** A selection inside one block, with a response that is a single paragraph, is replaced as inline text inside that block.
- **Blocks.** Otherwise the blocks the selection touches are the original, and the response's blocks go after them.
- A response that grows a second paragraph while streaming switches from inline to blocks and is re-rendered.
- **Insert below** goes after the last selected block; **insert at cursor** goes after the cursor block, replacing it when it is empty.
- **Edit page** takes every block of the page body as the original.
- Streamed Markdown is parsed with the app's existing Markdown parser on each text delta, coalesced to one render per animation frame.

### 5.3 Accept and Undo

- **Accept** (Enter, the button, or a click outside after writing) first restores the original document without history, then applies the final result as one transaction that does enter history.
  One ⌘Z later restores the original exactly.
- **Undo** (⌘Z or the button) restores the original document without history and closes the popup.
  The change is cleared in a step of its own after the content, so the editor does not save a page that is already as it was saved.
- Undo during writing stops the request first.

### 5.4 Saving

- The editor does not report its content to the page editor while a change is pending, so typing from before the Writer saves as usual and the change itself never does.
- When the page must save while a change is pending (its tab closes, the app quits, or the workspace closes), it saves the last content it was told of, so only accepted text ever reaches disk.
- Content arriving from another tab of the same page closes the Writer first.
- After Accept the editor saves as it does after typing.

### 5.5 Claude's answer

- A code fence around the whole answer (` ```markdown ` or ` ```md `) is taken off; other fences stay.
- Images, video, audio, files and drawings in the answer are left out, so an answer can never make the page or the popup load a remote file.

### 5.6 Scope

- One Writer per tab.
- Opening the Writer reads the browser's selection first: ProseMirror takes a click's selection a few milliseconds later, and a fast ⌘J would otherwise act on the old one.
- Leaving the page or closing its tab stops the request and undoes the pending change.
- A page changed outside the app while a change is pending is handled after Accept or Undo by the existing conflict flow.

## 6. Requests

### 6.1 Shape

- `client.beta.messages.stream` with:
  - the model from Settings;
  - `max_tokens: 32000`, so page translations fit;
  - `output_config: { effort: 'low' }`, with thinking left at the model's default and never displayed;
  - `fallbacks: 'default'` with the beta `server-side-fallback-2026-07-01`, so a refusal is retried by Anthropic's router (Opus 5.5 and Sonnet 5.5 only).
- No `temperature`, `top_p` or `top_k`; the API rejects them since 2026-10-21.
- `maxRetries: 0`: a retry would wait out the server's `retry-after` while the Writer says nothing.
- A 60-second idle timeout between stream events.

### 6.2 Messages

- `system`: one fixed prompt, identical for every request, stating the role, the markers, and the rules:
  - output Markdown only, with no preamble;
  - keep the selection's language unless asked to translate;
  - keep links, page mentions and formatting;
  - invent no facts.
- First user message:
  1. A text block holding the page as `<page title="…">…</page>`, with the selection wrapped in `⟦selection⟧…⟦/selection⟧` or the cursor marked `⟦cursor⟧`, and `cache_control: { type: 'ephemeral' }`.
  2. A text block with the skill's instruction, or the typed text.
- Follow-ups append the assistant response's full `content` unchanged (thinking blocks included), then a user message with the follow-up.
- Page Markdown comes from the existing serializer.
- Images, video, audio, files and drawings are replaced by `[image]`, `[video]`, `[audio]`, `[file]` and `[drawing]`, written as raw Markdown so the brackets are not escaped.
- Selected blocks are wrapped by markers on lines of their own.
- Pages over 100,000 characters keep the 100,000 characters centred on the selection, with `[…]` where text was cut.

### 6.3 Tools for free text

Skills stream plain text.
Typed instructions add two strict tools with `eager_input_streaming: true` and `tool_choice: auto`:

- With a selection: `edit({ markdown })` and `reply({ markdown })`.
- Without one: `insert({ markdown })` and `reply({ markdown })`.

The system prompt tells Claude to call exactly one.
The tool's streamed input is parsed incrementally and rendered as an edit, insert or reply.
A response with plain text and no tool call is treated as a reply.

## 7. Main process

New folder `src/main/ai/`:

- `keyStore.ts`
  - Saves the key with `safeStorage.encryptString` to `<userData>/anthropic-key.bin` with mode 0600, reads it back, and deletes it.
  - Refuses to save when `safeStorage.isEncryptionAvailable()` is false.
  - Only `hasKey` and a hint (`sk-ant-…` plus the last four characters) ever leave this module.
  - Under `NOBSIDIAN_E2E=1` a test codec stands in for `safeStorage`, so tests never touch the macOS Keychain.
- `codecs.ts`: the `safeStorage` codec, and the test codec.
- `client.ts`: builds the SDK client from the key, always passing the base URL so `ANTHROPIC_BASE_URL` in the user's environment cannot redirect the key; reads `NOBSIDIAN_AI_BASE_URL` only under `NOBSIDIAN_E2E=1`.
- `prompts.ts`: pure functions that build `system`, messages and tools for a skill or instruction.
- `service.ts`: key checks, status, and streaming; keeps one conversation per open Writer and an `AbortController` per request.
- `handlers.ts`: the IPC handlers; events go back to the window that asked.
- `usage.ts`
  - A ledger in `<userData>/ai-usage.json` keyed by month (`2026-10`): requests, input, output, cache write and cache read tokens, and dollars.
  - Dollars come from the price table below, using the model named in the response, which differs from the request when a fallback served it.
  - Output tokens include thinking.
- `errors.ts`: maps SDK error classes to the kinds in section 9.

Prices per million tokens, from Anthropic's pricing page on 2026-10-26:

| Model | Input | 5m cache write | Cache read | Output |
|---|---|---|---|---|
| `claude-opus-5-5` | $4 | $5 | $0.20 | $20 |
| `claude-sonnet-5-5` | $2 | $2.50 | $0.10 | $10 |
| `claude-haiku-5-5` | $0.10 | $0.125 | $0.01 | $0.50 |

Haiku 5.5 is dearer above 100,000 input tokens; the 100,000-character page cap keeps requests well below that.
Models a refusal fallback may answer with (Opus 5, Opus 4.8, Sonnet 5, Fable 5.1) are priced too, and an unknown model at the dearest known rates, so the total never reads low.

### 7.1 IPC

Added to `IpcContract`:

| Channel | Payload | Result |
|---|---|---|
| `ai:status` | none | `{ hasKey, keyHint, encryptionAvailable, month: { requests, dollars } }` |
| `ai:setKey` | `{ key }` | `{ ok: true }` or `{ ok: false, error }`, after checking the key with `models.list` |
| `ai:clearKey` | none | none |
| `ai:start` | `{ sessionId, requestId, title, markdown, skill?, instruction?, followUp?, selection }` | none |
| `ai:cancel` | `{ requestId }` | none |
| `ai:end` | `{ sessionId }` | none |

Added to `IpcEvents`:

| Event | Data |
|---|---|
| `ai:delta` | `{ requestId, mode: 'edit' \| 'insert' \| 'reply', text }`, the full text so far |
| `ai:done` | `{ requestId }` |
| `ai:error` | `{ requestId, kind, message }` |

Non-secret settings join `Settings`: `ai: { enabled: boolean; model: string }`, defaulting to `{ enabled: true, model: 'claude-opus-5-5' }`.

## 8. Settings

### 8.1 Window

- A Settings modal with the measurements of Notion's (web client, 2026-10-25): 90vw up to 1512px wide, the window's height less 100px, 12px radius; a 240px nav on the sidebar background; pages padded 36px by up to 60px, at most 800px wide; 26px page titles, 16px section titles over a divider, 14px row labels over 13px descriptions; a 30 by 18px toggle.
- Opened with ⌘, (a new app menu item "Settings…") and from a new "Settings" row at the bottom of the sidebar, above Trash.
- The nav groups pages as Notion does: **Account › Preferences** and **Features › AI**.
- **Preferences** has an Appearance section with a **Theme** row, "Choose a theme for Nobsidian on this device": Use system setting, Light, Dark.
- **AI** is described as "Write and edit your pages with Claude, using your own Anthropic API key.", with a General section (the rows below) and a Usage section.

### 8.2 AI section

1. A privacy note on a light grey background:
   "AI features send the text of the page you're on, and what you type in the AI box, to Anthropic using your API key.
   Images, files, drawings and other pages are never sent.
   Anthropic deletes API data within 30 days and doesn't train on it without your permission."
   It links to <https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data>.
2. **Show AI in the editor**, a toggle described as "The Ask AI button, ⌘J, /ai and Space on an empty line".
3. **Anthropic API key**, described as "Stored encrypted on this Mac, never in your notes folder." with a "Get a key" link to <https://platform.claude.com/settings/keys>.
   - With no key it shows a password field and Save; Save shows "Checking…", then "✓ Key works" or the error.
   - With a key it shows the hint and Remove.
   - Without encryption it explains that the key cannot be stored safely on this Mac.
4. **Model**: a select of Claude Opus 5.5, Claude Sonnet 5.5 and Claude Haiku 5.5, described as "Opus: best writing, about 2¢ per action. Sonnet: faster, about 1¢. Haiku: fastest, under 0.1¢."
5. **This month**: dollars and requests, described as "Counted on this Mac from Anthropic's reported usage. Your bill and spend limits are in the Anthropic Console." with a link to <https://platform.claude.com/>.

### 8.3 Setup card

The first time an entry point is used with no key, the popup shows a setup card instead of the prompt:

- the title "Set up AI";
- "Nobsidian uses Claude, with your own Anthropic API key. AI features send the text of the page you're on to Anthropic. Images, files, drawings and other pages are never sent." with "Learn more" opening Settings › AI;
- a key field with Save, and "Get a key from Anthropic".

Saving a working key turns the card into the prompt.

## 9. Errors and offline

| Kind | Cause | Message |
|---|---|---|
| `auth` | 401 | "Your API key was rejected." with an "Open Settings" link |
| `rate` | 429 | "Too many requests right now. Try again in N seconds." |
| `busy` | 529 and other 5xx | "Claude is busy right now. Try again in a moment." |
| `network` | connection failure or timeout | "Can't reach Anthropic. Check your internet connection." |
| `request` | other 4xx | "Anthropic said: " and the API's message |
| `refusal` | `stop_reason: refusal` after fallbacks | "Claude declined this request." |
| `truncated` | `stop_reason: max_tokens` | "The response was cut off." |

- An error after some text keeps the partial pending change, with Undo and Accept.
- The renderer listens for `online` and `offline` events and updates the entry points at once.
- Nothing is queued while offline.

## 10. Testing

### 10.1 Unit (vitest)

Editor tests mount a real BlockNote editor under `happy-dom` (a dev dependency), since an editor's plugins only exist once it is mounted.

- `prompts.ts`: system prompt bytes stable across calls; page block with markers and `cache_control`; image, file and drawing placeholders; the 100,000-character cut; tools only for free text.
- `usage.ts`: cost for each model, with cache writes and reads; month rollover.
- `errors.ts`: each SDK error class to its kind.
- `keyStore.ts`: encrypt, read, delete and hint with `safeStorage` mocked; refusal when encryption is unavailable.
- `aiPending`: ranges mapped through edits; inline to blocks switch; Accept as one history step; Undo restores the exact document.
- Incremental parsing of partial Markdown and partial tool JSON.
- Skill filtering and the "…to…" prefill.

### 10.2 Fake Anthropic server

`e2e/fakeAnthropic.ts` runs a Node HTTP server on a random port, started by the fixture and passed to the app as `NOBSIDIAN_AI_BASE_URL`.

- `POST /v1/messages` streams the real event sequence: `message_start`, `content_block_start`, `content_block_delta` (`text_delta` or `input_json_delta`), `content_block_stop`, `message_delta` with usage and stop reason, then `message_stop`.
- `GET /v1/models` answers the key check.
- The key is read from `x-api-key` or a bearer token; the SDK sends the latter.
- Each test scripts the next responses:
  - text or a tool call, split into chunks with delays;
  - held open until released;
  - dropped mid-stream;
  - any status code with an error body;
  - a refusal.
- Every request is recorded so tests can assert headers, model, effort, `cache_control`, the page text sent, and that no image data was sent.

### 10.3 End to end (Playwright)

- Setup card: a bad key shows the error; a good key opens the prompt.
- Each entry point opens the Writer: toolbar, ⌘J, `/ai`, Space.
- Make shorter streams a diff; the file on disk is unchanged while the server holds the stream open; Accept writes the new text; one ⌘Z restores the original.
- Undo leaves the file and history untouched.
- Stop keeps the partial change.
- Clicking outside after writing accepts.
- Summarize inserts below; Continue writing inserts at the cursor; Explain shows a reply and Insert below works.
- A typed question gets a reply; a typed instruction gets an edit.
- A follow-up revises the pending change.
- Each error kind shows its message; 401 links to Settings.
- Offline greys out the entry points.
- Switching tabs or closing the tab during writing removes the pending change.
- Settings shows the month's total after requests; the toggle hides AI.
- The key is absent from `settings.json`, from the notes folder, and from every renderer-visible value.
- Look tests capture the popup states and the diff in light and dark.

## 11. Files

New:

- `src/main/ai/` (section 7) and its tests
- `src/shared/ai.ts`: models, skills and IPC types shared by both sides
- `src/renderer/src/ai/`: the pending change plugin, page context, Writer, its model and entry points, the key field, the AI store and links
- `src/renderer/src/components/SettingsModal.tsx`
- `e2e/fakeAnthropic.ts`, `e2e/window.d.ts`, `e2e/ai-service.spec.ts`, `e2e/settings.spec.ts`, `e2e/ai.spec.ts`, `e2e/ai-edges.spec.ts`

Changed:

- `src/shared/ipc.ts`, `src/main/handlers.ts`, `src/main/settings.ts`, `src/main/menu.ts`
- `src/renderer/src/editor/Editor.tsx` (toolbar button, ⌘J, Space, hint), `slashItems.tsx` (AI group)
- `src/renderer/src/components/PageEditor.tsx` (passes the title), `Sidebar.tsx` (Settings row), `App.tsx`, `store.ts`, `icons.tsx`
- `src/renderer/src/styles/app.css`, `tokens.css`, `editor/editor.css`
- `e2e/fixtures.ts`, `e2e/helpers.ts`, `e2e/toolbar.spec.ts`, `package.json` (`@anthropic-ai/sdk`, `happy-dom`)
