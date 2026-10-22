import { COLOR_NAMES, type BlockColors, type ColorName } from '../core/blocks'

const NAMES = new Set<string>(COLOR_NAMES)

/** Notion's color names ("red", "red_background", "teal") as text or background colors. */
export function notionColor(value: string | undefined): BlockColors {
  if (!value) return {}
  const background = value.endsWith('_background') || value.endsWith('_bg')
  const base = value.replace(/_(background|bg)$/, '')
  // Notion calls its green "teal" internally.
  const name = base === 'teal' ? 'green' : base
  if (!NAMES.has(name)) return {}
  return background ? { backgroundColor: name as ColorName } : { textColor: name as ColorName }
}

/** The color in a `block-color-<c>`, `highlight-<c>` or `select-value-color-<c>` class list. */
export function colorFromClasses(classes: string[], prefix: string): BlockColors {
  for (const c of classes) if (c.startsWith(prefix)) return notionColor(c.slice(prefix.length))
  return {}
}
