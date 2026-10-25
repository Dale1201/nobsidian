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
