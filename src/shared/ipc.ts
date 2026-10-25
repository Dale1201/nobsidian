import type { Block } from './core/blocks'
import type {
  HistoryVersion,
  ImportStatus,
  PageDoc,
  PageMetaPatch,
  PageNode,
  SearchHit,
  TrashItem,
  WorkspaceInfo,
  WriteResult
} from './types'

export type ThemePreference = 'system' | 'light' | 'dark'

/** Per-machine UI state, stored in Electron's userData folder. */
export interface Settings {
  lastWorkspace?: string
  theme: ThemePreference
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** Workspace root -> ids of expanded sidebar rows. */
  expanded: Record<string, string[]>
  /** Workspace root -> id of the page open when the app last closed; read only when no tabs are saved. */
  lastPage: Record<string, string>
  /** Workspace root -> its open tabs. */
  tabs: Record<string, SavedTabs>
  windowBounds?: { x: number; y: number; width: number; height: number }
  /** Workspace root -> ids of recently opened pages, newest first. */
  recent: Record<string, string[]>
  /** The color Cmd+Shift+H applies: the last one picked in the formatting toolbar. */
  lastColor: { kind: 'text' | 'background'; color: string }
}

/** A workspace's tabs: each tab's page history and position in it, and which tab is active. */
export interface SavedTabs {
  tabs: { history: string[]; index: number }[]
  active: number
}

export const RECENT_LIMIT = 20

export interface TreeSnapshot {
  pages: PageNode[]
  favorites: string[]
}

export type MenuCommand =
  | 'new-page'
  | 'open-folder'
  | 'import-notion'
  | 'search'
  | 'toggle-sidebar'
  | 'toggle-theme'
  | 'back'
  | 'forward'

/** What a dropped zip is, judged from its file names. */
export type ZipKind = 'notion-html' | 'notion-markdown' | 'other'

export interface IpcContract {
  'workspace:current': [payload: void, result: WorkspaceInfo | null]
  'workspace:choose': [payload: void, result: WorkspaceInfo | null]
  'tree:get': [payload: void, result: TreeSnapshot]
  'page:read': [payload: { id: string }, result: PageDoc]
  'page:write': [
    payload: { id: string; blocks: Block[]; revision: number; force?: boolean },
    result: WriteResult
  ]
  'page:meta': [payload: { id: string; patch: PageMetaPatch }, result: void]
  'page:create': [
    payload: { parentId: string | null; index?: number; title?: string; blocks?: Block[] },
    result: PageNode
  ]
  'page:rename': [payload: { id: string; title: string }, result: void]
  'page:move': [payload: { id: string; parentId: string | null; index: number }, result: void]
  'page:trash': [payload: { id: string }, result: void]
  'page:duplicate': [payload: { id: string }, result: PageNode]
  'search:query': [payload: { query: string }, result: SearchHit[]]
  'trash:list': [payload: void, result: TrashItem[]]
  'trash:read': [payload: { entry: string }, result: PageDoc]
  'trash:restore': [payload: { entry: string }, result: string]
  'trash:delete': [payload: { entry: string }, result: void]
  'history:list': [payload: { id: string }, result: HistoryVersion[]]
  'history:read': [payload: { id: string; version: string }, result: PageDoc]
  'history:restore': [payload: { id: string; version: string }, result: void]
  'history:checkpoint': [payload: { id: string }, result: void]
  'history:draft': [payload: { id: string; blocks: Block[] }, result: void]
  'page:favorite': [payload: { id: string; favorite: boolean }, result: void]
  'attachment:save': [payload: { name: string; data: Uint8Array }, result: string]
  'attachment:chooseImage': [payload: void, result: string | null]
  'attachment:open': [payload: { href: string }, result: void]
  /** The text of a drawing file, or null when it is missing. */
  'drawing:read': [payload: { href: string }, result: string | null]
  /** Downloads an image from the web into attachments/; returns its internal href. */
  'attachment:fetch': [payload: { url: string }, result: string]
  /** Picks Notion export zips and starts importing them; false if the picker was cancelled. */
  'import:choose': [payload: void, result: boolean]
  'import:start': [payload: { paths: string[] }, result: void]
  'import:cancel': [payload: void, result: void]
  'import:peek': [payload: { paths: string[] }, result: ZipKind[]]
  /** Imported pages by Notion id (32 hex), for pasted links to them. */
  'notion:pages': [payload: { notionIds: string[] }, result: Record<string, string>]
  'settings:get': [payload: void, result: Settings]
  'settings:set': [payload: Partial<Settings>, result: Settings]
  'shell:openExternal': [payload: { url: string }, result: void]
  'app:flushed': [payload: { saved: boolean }, result: void]
}

export type IpcChannel = keyof IpcContract
export type IpcPayload<C extends IpcChannel> = IpcContract[C][0]
export type IpcResult<C extends IpcChannel> = IpcContract[C][1]

export interface IpcEvents {
  'tree:changed': TreeSnapshot
  'page:changed': { id: string; revision: number }
  'workspace:missing': void
  'menu:command': MenuCommand
  'app:flush': void
  'import:status': ImportStatus
}

export interface Api {
  invoke<C extends IpcChannel>(channel: C, payload: IpcPayload<C>): Promise<IpcResult<C>>
  on<E extends keyof IpcEvents>(event: E, listener: (data: IpcEvents[E]) => void): () => void
  /** The path of a file dropped on the window. */
  pathForFile(file: File): string
}

export const ASSET_SCHEME = 'nbfile'
/** The host under ASSET_SCHEME that serves Excalidraw's bundled fonts. */
export const EXCALIDRAW_HOST = 'excalidraw'
