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
