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
