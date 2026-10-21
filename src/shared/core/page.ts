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
