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

/** Start (inclusive) and end (exclusive) offsets of a highlighted span. */
export type TextRange = [number, number]

export interface SearchHit {
  id: string
  titleRanges: TextRange[]
  /** One line of matching content, or null when only the title matched. */
  snippet: { text: string; ranges: TextRange[] } | null
}
