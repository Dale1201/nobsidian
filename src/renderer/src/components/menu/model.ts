import type { ReactNode } from 'react'

export interface MenuItemEntry {
  kind: 'item'
  id: string
  label: string
  icon?: ReactNode
  /** Muted text on the right, such as a shortcut. */
  hint?: string
  danger?: boolean
  /** Shown greyed out; keyboard and mouse skip it. */
  disabled?: boolean
  checked?: boolean
  /** Extra words the search box matches. */
  keywords?: string[]
  submenu?: MenuEntry[]
  onSelect?: () => void
}

export type MenuEntry = MenuItemEntry | { kind: 'section'; label: string } | { kind: 'separator' }

/** Matching items, with submenu items brought up to the top level, as Notion's search does. */
export function filterEntries(entries: MenuEntry[], query: string): MenuEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return entries
  const matches = (e: MenuItemEntry): boolean => {
    const text = [e.label, ...(e.keywords ?? [])].join(' ').toLowerCase()
    return words.every((w) => text.includes(w))
  }
  const out: MenuEntry[] = []
  for (const entry of entries) {
    if (entry.kind === 'section') out.push(entry)
    if (entry.kind !== 'item') continue
    if (matches(entry)) out.push(entry)
    if (entry.submenu) {
      out.push(...filterEntries(entry.submenu, query).filter((e) => e.kind === 'item'))
    }
  }
  return out.filter((e, i) => e.kind !== 'section' || out[i + 1]?.kind === 'item')
}

export function moveIndex(entries: MenuEntry[], from: number, delta: 1 | -1): number {
  const items = entries.flatMap((e, i) => (e.kind === 'item' && !e.disabled ? [i] : []))
  if (items.length === 0) return -1
  const at = items.indexOf(from)
  if (at === -1) return delta === 1 ? items[0] : items[items.length - 1]
  return items[(at + delta + items.length) % items.length]
}

export type HintKey = Pick<KeyboardEvent, 'key' | 'metaKey' | 'shiftKey' | 'altKey' | 'ctrlKey'>

const MODIFIERS = { '⌘': 'metaKey', '⇧': 'shiftKey', '⌥': 'altKey', '^': 'ctrlKey' } as const

/** Whether a key press is the shortcut a hint such as "⌘⇧P" or "Del" shows. */
export function hintMatches(hint: string, e: HintKey): boolean {
  if (hint === 'Del') {
    return (e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.altKey && !e.ctrlKey
  }
  const mods = new Set<string>()
  let rest = hint
  while (rest[0] in MODIFIERS) {
    mods.add(MODIFIERS[rest[0] as keyof typeof MODIFIERS])
    rest = rest.slice(1)
  }
  // Without a modifier a hint is a Markdown shortcut such as "#", typed in the editor.
  if (mods.size === 0 || !rest) return false
  if (Object.values(MODIFIERS).some((m) => e[m] !== mods.has(m))) return false
  return rest === '↵' ? e.key === 'Enter' : e.key.toLowerCase() === rest.toLowerCase()
}
