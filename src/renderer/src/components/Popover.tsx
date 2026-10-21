import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PopoverProps {
  anchor: DOMRect
  align?: 'start' | 'end'
  onClose: () => void
  children: ReactNode
  className?: string
}

/** Fixed-position floating panel anchored under a rect; closes on outside click and Escape. */
export function Popover({
  anchor,
  align = 'start',
  onClose,
  children,
  className
}: PopoverProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: anchor.bottom + 4, left: anchor.left })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    let left = align === 'end' ? anchor.right - width : anchor.left
    let top = anchor.bottom + 4
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 4)
    setPos({ top, left })
  }, [anchor, align])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} className={`menu ${className ?? ''}`} style={{ top: pos.top, left: pos.left }}>
      {children}
    </div>,
    document.body
  )
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
}

export function Menu({
  anchor,
  align,
  items,
  onClose
}: {
  anchor: DOMRect
  align?: 'start' | 'end'
  items: (MenuItem | 'separator')[]
  onClose: () => void
}): React.JSX.Element {
  return (
    <Popover anchor={anchor} align={align} onClose={onClose}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="menu-separator" />
        ) : (
          <button
            key={item.label}
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.icon}
            {item.label}
          </button>
        )
      )}
    </Popover>
  )
}
