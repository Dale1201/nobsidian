# Nobsidian - Tabs Design Spec

Date: 2026-10-25
Status: Draft for review

## 1. Purpose

Nobsidian shows one page at a time.
The owner wants multiple tabs that behave like the tabs in Notion's Mac app, so several pages can stay open and be switched between without losing place.
Notion parity is the yardstick.

### What Notion does

Notion's help pages say little about tabs, so the facts below come from the tab bar and menu code in Notion 7.40.1 (`/Applications/Notion.app`, `app.asar`), read on 2026-10-25.

- One 36px tab bar spans the top of the window and replaces the title bar.
- Its left segment is as wide as the sidebar (with a 1px divider on its right) and holds the traffic lights and the sidebar toggle; with the sidebar collapsed it shrinks to fit them.
- Back and forward buttons follow, then the tabs, then a `+` button.
- The bar uses the sidebar's background with a 1px divider along its bottom.
- Tabs are flat rectangles separated by 1px lines; the active tab takes the page background and has no bottom border, so it joins the page below.
- Tabs share the width equally between 36px and 200px each.
- A tab shows the page icon and the title in 13px medium; inactive tabs use secondary text, a 75% opacity icon, and a title that fades out instead of ending in an ellipsis.
- A 16px close button fades in on hover, over a short gradient.
- Mouse-down activates a tab, middle-click closes it, right-click opens the tab menu, and dragging reorders with a blue drop line (`rgba(35, 131, 226, 0.43)`).
- Shortcuts: ⌘T new tab, ⌘W close tab (closing the last tab closes the window), ⌘⇧W close window, ⌘⇧T reopen the last closed tab or batch, ⌃Tab / ⌃⇧Tab, ⌘⌥→ / ⌘⌥← and ⌘⇧] / ⌘⇧[ next and previous tab (wrapping), ⌘1 to ⌘8 select a tab, ⌘9 selects the last tab, ⌘[ / ⌘] back and forward in the active tab.
- ⌘-click on a link opens it in a new tab.
- The tab menu has Copy Link, Refresh Tab, Duplicate Tab, Pin Tab, Move Tab to New Window, Reopen Last Closed Tab, Close Tab, Close Other Tabs, Close Tabs to the Left and Close Tabs to the Right.
- Open tabs are restored after a restart.
- Notion's desktop beta keeps every tab of a window in one renderer, so tabs keep their scroll position and selection.

### Success criteria

- Side by side with Notion, the tab bar is indistinguishable at a glance in light and dark mode.
- Every shortcut and mouse gesture in section 4 behaves as described.
- No edit is lost by switching, closing or reordering tabs, by having one page open in two tabs, or by a page changing outside the app.
- Quitting and relaunching brings back each workspace's tabs.

### Out of scope

Pinned tabs, tab groups, multiple windows (and Move Tab to New Window), opening Search first on ⌘T, Copy Link, Refresh Tab, Quit Without Saving Tabs, and saving scroll positions across restarts.

## 2. Decisions

| Topic | Decision |
|---|---|
| Scope | Core tabs plus Reopen Closed Tab and the tab menu. No pinned tabs and no Search-first new tab. |
| New tab | ⌘T and `+` open the current page in a new tab after the current one, and switch to it. |
| Open in new tab | Browser rule: ⌘-click and middle-click open in the background, ⌘⇧-click opens in the foreground. |
| Deleted page | Tabs showing it stay put and show the existing read-only trashed view with Restore and Delete forever. |
| Last tab | ⌘W on the last tab closes the window. |
| Inactive tabs | Keep each visited tab mounted and hidden, so it keeps scroll, caret, selection, undo history and banners. Restored tabs mount on first activation. A single live editor was rejected because switching would remount (slow, loses undo and selection) and leaving a page during a conflict settles the conflict. |
| Window | Nobsidian stays single-window. |

## 3. Layout and look

### Tab bar

A new 36px tab bar spans the window width above the sidebar and the page.
Its background is `--bg-sidebar`, with a 1px `--divider` along the bottom.
Empty space in the bar is a window drag region, so double-click zooms as the title bar does today.

From left to right:

1. The left segment.
   With the sidebar open it is exactly the sidebar's width, follows it live during a resize, and has a 1px `--divider` on its right in line with the sidebar's border.
   It holds the traffic lights (the existing `trafficLightPosition` is adjusted to centre them in 36px) and the sidebar toggle at its right end.
   With the sidebar collapsed it is just wide enough for the traffic lights and the toggle.
2. Back and forward buttons for the active tab's history, dimmed when there is nowhere to go.
3. The tabs.
4. The `+` new tab button, right after the last tab.

### Tabs

- Flat and square, separated by 1px `--divider` lines, with a line after the last tab.
- Inactive: no fill of their own, a bottom `--divider`, secondary text, icon at 75% opacity, title clipped with a 9px fade to the bar colour.
- Hover: the bar colour 5% darker in light mode and 5% lighter in dark mode.
- Active: `--bg` fill, no bottom border, primary text, full opacity icon, title ending in an ellipsis.
- Width: each tab grows from 36px to 200px and the tabs share the space equally; at 36px only the icon shows, centred.
  When even 36px tabs do not fit, the tab list scrolls sideways without a scrollbar, and the active tab is always scrolled into view.
- Content: the page icon (or the default page icon), then the title in 13px medium, with "Untitled" for an empty title.
  The tooltip is the full title.
- Close: a 16px ✕ in a 20px button with a 6px radius, over a 16px fade, appears on hover and keyboard focus.
  It stays visible on the active tab while the tab is wider than 72px.
- A hidden tab whose page has a conflict shows a small amber dot (`--color-yellow`) in place of its close button until it is hovered.
- Dragging shows a 2px `--accent` drop line at 43% opacity between tabs.

### What moves

- The sidebar's header row is removed.
  Its hide-sidebar button moves into the tab bar's left segment.
  Its new-page button moves to the right end of the workspace row, as in Notion.
- The page top bar (breadcrumbs, star, ⋯) stays at the top of each tab's page.
  It no longer reserves 80px for the traffic lights when the sidebar is collapsed, and no longer shows the show-sidebar button.
- The trashed page view's top bar changes the same way.
- Colours come from the existing tokens, so dark mode follows.

## 4. Behaviour

### Opening

- ⌘T, the `+` button and File > New Tab open the active tab's current page in a new tab right after the active one and switch to it.
  The new tab's history holds just that page.
- ⌘-click or middle-click on a page link opens the page in a background tab.
  ⌘⇧-click opens it in a foreground tab.
  This covers links and mentions in pages (including read-only ones), sidebar rows (pages and Favorites) and breadcrumbs.
- In Search, ⌘↵ and ⌘-click on a result open it in a background tab; ⌘⇧↵ and ⌘⇧-click open it in a foreground tab.
- The sidebar row ⋯ menu gains "Open in new tab", which opens a foreground tab.
- Background tabs go right after the active tab, and each further one opened from the same tab goes after the previous one (Chrome's rule).
  The run resets when the active tab changes.
- External links and attachments ignore the modifiers and open as today.
- A plain click navigates the active tab.
- Creating a page (⌘N, `+` in the sidebar, Duplicate, Restore) opens it in the active tab, as today.

### Closing

- ⌘W, the tab's ✕, middle-click on the tab, and the tab menu close a tab.
- When the active tab closes, the tab to its right becomes active, or the one to its left if it was the last.
- Closing the last tab saves it as the workspace's only tab and closes the window through the existing flush-then-close flow.
  Clicking the Dock icon opens the window again on that page.
- ⌘⇧W and File > Close Window close the window.
- Reopen Closed Tab (⌘⇧T, File menu, tab menu) reopens the most recently closed tab at its old position with its history, and activates it.
  Close Other Tabs and Close Tabs to the Left or Right record one batch, which reopens together.
  The stack keeps 20 entries per workspace, lives only in memory, and is cleared when the workspace changes.

### Reordering

- Dragging a tab sideways moves it, showing the drop line where it will land.
- A tab activates on mouse-down; dragging starts once the pointer has moved 4px, so a click is never a drag.

### Switching

- Mouse-down on a tab.
- ⌃Tab, ⌘⌥→ and ⌘⇧] select the next tab; ⌃⇧Tab, ⌘⌥← and ⌘⇧[ select the previous one; both wrap around.
- ⌘1 to ⌘8 select that tab if it exists; ⌘9 selects the last tab.
- The Window menu shows Show Next Tab (⌃Tab) and Show Previous Tab (⌃⇧Tab); the other combinations are hidden menu items.
- ⌘[ and ⌘] and the bar's arrows go back and forward in the active tab only.

### Tab menu

Right-click on a tab opens the app's existing `Menu` with:

- Duplicate Tab: copies the tab's history and position into a new tab after it, and activates the copy.
- Reopen Closed Tab: disabled when the stack is empty.
- Close Tab.
- Close Other Tabs: disabled with one tab.
- Close Tabs to the Left: disabled for the first tab.
- Close Tabs to the Right: disabled for the last tab.

### Menu bar

- File: New Tab ⌘T, New Page ⌘N, Open Folder… ⌘O, Reopen Closed Tab ⌘⇧T, Import from Notion…, Close Tab ⌘W, Close Window ⌘⇧W.
  Close Tab replaces the `close` role that ⌘W has today.
- Window: Show Previous Tab, Show Next Tab, then the standard items.

## 5. Per-tab state

### History and scroll

- Each tab has a list of entries and the index of the current one.
  An entry is a page (`{ kind: 'page', pageId, scroll }`) or a Trash entry opened from the Trash popover (`{ kind: 'trash', entry, scroll }`).
- Leaving an entry records its scroll position; back and forward restore it.
- Navigating to a new page drops the entries after the current one, appends the page and starts at the top.
- Opening the page a tab is already on reveals it in the sidebar, as today.
- Back and forward skip pages that no longer exist, as today.
- Each tab keeps at most 50 entries; the oldest are dropped first.

### Mounted and hidden tabs

- A tab mounts its view the first time it is active and stays mounted until it closes.
  Navigating within a tab replaces its view, as navigating does today.
- Inactive tabs are hidden in a way that keeps their scroll position, caret, selection and undo history.
- Switching away from a tab immediately saves its pending edits with a normal save, so a conflict stays a conflict.
- Hidden editors cannot take focus, and global shortcuts act on the active tab.

### Sidebar, Search and overlays

- The highlighted sidebar row is the active tab's page.
- Switching tabs does not expand or scroll the sidebar; navigating does, as today.
- Search, Move to and Page history are app-wide and act on the active tab.
- Recent pages record a page when it is navigated to and when its tab is activated.

### The same page in two tabs

- After an editor saves, it announces the page id and new revision on a renderer event channel.
  Other editors of the page treat it like `page:changed`: with no unsaved edits they reload quietly and keep their scroll; with unsaved edits they show the conflict banner.
- Icon, cover and full-width changes are announced the same way and applied by the other tabs.
- Rescued edits stay keyed by page id; the first editor of the page to mount takes them.

### Renamed pages

Tab titles, tab icons and breadcrumbs read the tree, so a rename or icon change, made in the app or outside it, updates every tab immediately.

### Deleted pages

- When a tab's page leaves the tree, the store looks the page up in the Trash.
  `TrashItem` gains `pageIds`, the ids of the page and its sub-pages in the entry.
- Found: the tab shows `TrashedPageView` for the entry containing the page.
  For a sub-page deleted with its parent, that is the parent's entry.
  The tab keeps showing the page's last known title and icon.
  Restore brings the tab back to the live page.
- Not found (deleted outside the app, or deleted forever): the tab steps back to the nearest earlier entry whose page still exists.
  With none, the tab closes; if it was the only tab, it opens the first page, as the app does today.
  Unsaved edits to the vanished page still go to "Recovered edits", as today.
- This replaces today's jump to the first page when the open page is deleted.

### Pages changed outside the app

- Every mounted tab of the page handles `page:changed` on its own.
- With no unsaved edits it reloads quietly, keeping its scroll.
- With unsaved edits it shows the conflict banner, in that tab only.
- A hidden tab with a conflict shows the amber dot on its tab.

### Closing a tab with unsaved edits

- Closing a tab unmounts its view, which saves exactly as leaving a page does today.
- During a conflict, the tab's edits go to the page's history.
- If the save fails, the rescued edits reopen the page in a new foreground tab instead of the active one.
- Quit and workspace switches save every tab through the existing flushers.

## 6. Restoring after a restart

- Settings gain `tabs: Record<workspaceRoot, SavedTabs>`, where `SavedTabs` is `{ tabs: { history: string[]; index: number }[]; active: number }` and `history` holds page ids.
- It is written whenever tabs open, close, move, switch or navigate.
  Trash entries and scroll positions are not saved.
- On launch and on Open Folder, the workspace's saved tabs come back with the same tab active.
  Entries whose page no longer exists and is not in the Trash are dropped, and tabs left with no entries are dropped.
  A page now in the Trash restores into the trashed view.
  With no tabs left, one tab opens on the first page.
- A workspace with no saved tabs opens one tab on its `lastPage`, so the update keeps the user's place.
  `lastPage` is no longer written after that.
- Restored tabs mount on first activation.

## 7. Architecture

### Renderer

- `src/renderer/src/lib/tabs.ts` (new): pure functions over `TabsState` (`tabs`, `activeId`, `closed`, and the opener run).
  Open with the insertion rule, close with the next active tab, close others, left and right, move, activate, next, previous and by index, navigate, back and forward with scroll, reopen, duplicate, `serialize` and `restore`.
  No React and no IPC, so every rule is unit-tested directly.
- `store.ts`: `currentId`, `history`, `historyIndex` and `trashEntry` are replaced by the tabs state.
  `currentId` stays as a field kept equal to the active tab's current page, so the sidebar, Search and other readers are unchanged.
  `openPage(id, { scroll?, tab? })` takes `tab: 'current' | 'background' | 'foreground'`.
  New actions: `newTab`, `closeTab`, `closeTabs`, `reopenClosedTab`, `duplicateTab`, `moveTab`, `activateTab`, `stepTab`, `selectTab`, `setTabScroll`, and the trash lookup.
  Every change is saved to settings.
- `components/TabBar.tsx` (new): left segment, back and forward, tabs, `+`, dragging, tab menu and amber dot.
- `components/TabPanes.tsx` (new): renders each mounted tab's `PageView` or `TrashedPageView` and hides the inactive ones.
- `PageView`, `TopBar` and `TrashedPageView` take `tabId` and their page or entry as props instead of reading the global current page.
- `Sidebar`: the header row goes, the new-page button moves to the workspace row, and the row menu gains Open in new tab.
- `lib/navigation.ts`: `openHref(href, { tab })`, plus `tabTarget(event)`, which maps ⌘, ⌘⇧ and middle-click to a tab target.
  The editor's link and mention handlers pass the click event through.
- `lib/pageEvents.ts` (new): the renderer event channel for page saves and meta changes.

### Main

- `menu.ts`: the new File and Window items and hidden accelerators, sending new `MenuCommand`s.
- `window:close` IPC: closes the window through the existing close flow.
- `page-trash.ts` / `trash.ts`: `TrashItem.pageIds`, read from the ids in the entry's page files.
- `settings.ts`: `tabs` defaults to `{}`.
- `index.ts`: `trafficLightPosition` is adjusted for the 36px bar.

## 8. Testing

### Unit (vitest)

- `lib/tabs.ts`: insertion run and its reset, next active tab on close, close others, left and right, batch reopen and the 20-entry limit, duplicate, move, wrap-around stepping, select by index and ⌘9, scroll per entry, the 50-entry history limit, and `restore` dropping missing pages and empty tabs.
- Store: tabs wiring, trash lookup, settings writes, `lastPage` migration.
- Settings defaults and the trash listing's `pageIds`.

### End to end (Playwright, hidden mode, new `e2e/tabs.spec.ts`)

- ⌘T and `+` open the current page in a new active tab.
- ⌘-click on a link and a mention, and middle-click on a sidebar row, open background tabs in run order; ⌘⇧-click opens a foreground tab; Search ⌘↵ opens a background tab.
- ⌘W, ✕ and middle-click close tabs and pick the next active tab; ⌘W on the last tab closes the window.
- ⌘⇧T reopens a single tab and a Close Other Tabs batch.
- Dragging reorders tabs.
- ⌃Tab, ⌘⌥→ and ⌘1..9 switch tabs.
- Back and forward per tab restore scroll; a hidden tab keeps scroll and undo history.
- Renaming a page and changing its icon update its tabs.
- Deleting a page shows the trashed view in its tabs, and Restore brings it back; deleting a file outside the app steps the tab back.
- An outside edit reloads a hidden tab quietly, or shows the amber dot and banner when it has unsaved edits.
- Typing in one tab updates the same page in another tab.
- Closing a tab with unsaved edits saves them.
- Relaunching restores each workspace's tabs.
- Existing specs and the reference screenshots are updated for the moved sidebar buttons and the tab bar.
- `look.spec.ts` checks the tab bar's metrics and colours in light and dark mode.
