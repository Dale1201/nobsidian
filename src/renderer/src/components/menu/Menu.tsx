import { useEffect, useMemo, useRef, useState } from 'react'
import { Popover } from '../Popover'
import { ChevronRightIcon } from '../icons'
import { filterEntries, moveIndex, type MenuEntry, type MenuItemEntry } from './model'

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
  const [active, setActive] = useState(() => moveIndex(shown, -1, 1))
  const [sub, setSub] = useState<{ index: number; rect: DOMRect } | null>(null)
  const rows = useRef<(HTMLButtonElement | null)[]>([])

  const [prevShown, setPrevShown] = useState(shown)
  if (prevShown !== shown) {
    setPrevShown(shown)
    setActive(moveIndex(shown, -1, 1))
    setSub(null)
  }

  const select = (index: number): void => {
    const entry = shown[index]
    if (entry?.kind !== 'item') return
    if (entry.submenu) {
      const rect = rows.current[index]?.getBoundingClientRect()
      if (rect) setSub({ index, rect })
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
      let handled = true
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setActive((i) => moveIndex(shown, i, e.key === 'ArrowDown' ? 1 : -1))
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

  const subEntry = sub ? (shown[sub.index] as MenuItemEntry | undefined) : undefined

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
          onChange={(e) => setQuery(e.target.value)}
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
              className={`menu-item ${i === active ? 'active' : ''} ${entry.danger ? 'danger' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={(e) => {
                setActive(i)
                const rect = e.currentTarget.getBoundingClientRect()
                setSub(entry.submenu ? { index: i, rect } : null)
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
      {sub && subEntry?.submenu && (
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
