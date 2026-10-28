import { useEffect, useMemo, useRef, useState } from 'react'
import { Popover } from '../Popover'
import { ChevronRightIcon } from '../icons'
import { filterEntries, hintMatches, moveIndex, type MenuEntry, type MenuItemEntry } from './model'

export interface MenuProps {
  anchor: DOMRect
  align?: 'start' | 'end'
  side?: 'below' | 'right'
  entries: MenuEntry[]
  onClose: () => void
  /** Placeholder of a search box that filters the entries. */
  search?: string
  header?: string
  className?: string
  /** Set on submenus, which render inside their parent. */
  nested?: boolean
  /** False for menus opened from the editor, which must keep its focus. */
  takeFocus?: boolean
}

// Choosing an item in a submenu closes the whole menu, not just the submenu.
function closeAfter(entries: MenuEntry[], close: () => void): MenuEntry[] {
  return entries.map((e) => {
    if (e.kind !== 'item') return e
    if (e.submenu) return { ...e, submenu: closeAfter(e.submenu, close) }
    return {
      ...e,
      onSelect: () => {
        close()
        e.onSelect?.()
      }
    }
  })
}

export function Menu(props: MenuProps): React.JSX.Element {
  const { entries, onClose, nested } = props
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterEntries(entries, query), [entries, query])
  // Kept by id, not index: callers rebuild entries on every render.
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sub, setSub] = useState<{ id: string; rect: DOMRect } | null>(null)
  const rows = useRef<(HTMLButtonElement | null)[]>([])

  const indexOf = (id: string | null): number =>
    id === null ? -1 : shown.findIndex((e) => e.kind === 'item' && e.id === id)
  const found = indexOf(activeId)
  const active = found === -1 ? moveIndex(shown, -1, 1) : found
  const idAt = (index: number): string | null => {
    const entry = shown[index]
    return entry?.kind === 'item' ? entry.id : null
  }

  const select = (index: number): void => {
    const entry = shown[index]
    if (entry?.kind !== 'item' || entry.disabled) return
    if (entry.submenu) {
      const rect = rows.current[index]?.getBoundingClientRect()
      if (rect) setSub({ id: entry.id, rect })
      return
    }
    onClose()
    entry.onSelect?.()
  }

  // Capture phase, so keys reach the menu before the editor, which may still have focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (sub) return
      const current = shown[active] as MenuItemEntry | undefined
      // "Del" must not take Backspace from a search box that still has text in it.
      const byHint = entries.find(
        (entry): entry is MenuItemEntry =>
          entry.kind === 'item' &&
          !entry.disabled &&
          !entry.submenu &&
          entry.hint !== undefined &&
          (entry.hint !== 'Del' || query === '') &&
          hintMatches(entry.hint, e)
      )
      let handled = true
      if (byHint) {
        onClose()
        byHint.onSelect?.()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setActiveId(idAt(moveIndex(shown, active, e.key === 'ArrowDown' ? 1 : -1)))
      } else if (e.key === 'Enter' || (e.key === 'ArrowRight' && current?.submenu)) {
        select(active)
      } else if (e.key === 'Escape' || (e.key === 'ArrowLeft' && nested)) {
        onClose()
      } else {
        handled = false
      }
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })

  useEffect(() => {
    rows.current[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const subIndex = sub ? indexOf(sub.id) : -1
  const subEntry = subIndex === -1 ? undefined : (shown[subIndex] as MenuItemEntry)

  return (
    <Popover
      anchor={props.anchor}
      align={props.align}
      side={props.side}
      portal={!nested}
      closeOnEscape={false}
      autoFocus={!nested && props.takeFocus !== false}
      onClose={onClose}
      role="menu"
      className={props.className}
    >
      {props.search !== undefined && (
        <input
          className="menu-search"
          autoFocus
          placeholder={props.search}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveId(null)
            setSub(null)
          }}
        />
      )}
      {props.header && !query && <div className="menu-section">{props.header}</div>}
      <div className="menu-list">
        {shown.length === 0 && <div className="menu-empty">No results</div>}
        {shown.map((entry, i) => {
          if (entry.kind === 'separator') return <div key={i} className="menu-separator" />
          if (entry.kind === 'section') {
            return (
              <div key={i} className="menu-section">
                {entry.label}
              </div>
            )
          }
          return (
            <button
              key={entry.id}
              ref={(el) => {
                rows.current[i] = el
              }}
              type="button"
              role="menuitem"
              aria-label={entry.label}
              aria-disabled={entry.disabled || undefined}
              className={`menu-item ${i === active ? 'active' : ''} ${entry.danger ? 'danger' : ''} ${entry.disabled ? 'disabled' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={(e) => {
                if (entry.disabled) return
                setActiveId(entry.id)
                const rect = e.currentTarget.getBoundingClientRect()
                setSub(entry.submenu ? { id: entry.id, rect } : null)
              }}
              onClick={() => select(i)}
            >
              {entry.icon && <span className="menu-item-icon">{entry.icon}</span>}
              <span className="menu-item-label">{entry.label}</span>
              {entry.hint && <span className="menu-item-hint">{entry.hint}</span>}
              {entry.checked && <span className="menu-item-check">✓</span>}
              {entry.submenu && <ChevronRightIcon size={12} className="menu-item-chevron" />}
            </button>
          )
        })}
      </div>
      {subEntry?.submenu && sub && (
        <Menu
          nested
          anchor={sub.rect}
          side="right"
          entries={closeAfter(subEntry.submenu, onClose)}
          onClose={() => setSub(null)}
        />
      )}
    </Popover>
  )
}
