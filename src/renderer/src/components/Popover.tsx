import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PopoverProps {
  anchor: DOMRect
  align?: 'start' | 'end'
  /** Below the anchor (default), beside it to the right top-aligned, or right and bottom-aligned. */
  side?: 'below' | 'right' | 'right-bottom'
  /** Clicks inside this element do not count as outside clicks. */
  ignore?: Element | null
  /** Rendered in place instead of in document.body, so a parent menu counts its clicks as inside. */
  portal?: boolean
  closeOnEscape?: boolean
  /** Moves focus into the panel when it opens. */
  autoFocus?: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  role?: string
}

/** Fixed-position floating panel anchored under a rect; closes on outside click and Escape. */
export function Popover({
  anchor,
  align = 'start',
  side = 'below',
  ignore,
  portal = true,
  closeOnEscape = true,
  autoFocus = false,
  onClose,
  children,
  className,
  role
}: PopoverProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: anchor.bottom + 4, left: anchor.left })

  // Re-placed whenever the content changes size, e.g. a list that loads after opening.
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() =>
      setSize({ width: el.offsetWidth, height: el.offsetHeight })
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    if (side === 'right') {
      const fitsRight = anchor.right + 4 + width <= window.innerWidth - 8
      const left = fitsRight ? anchor.right + 4 : Math.max(8, anchor.left - width - 4)
      setPos({ top: Math.max(8, Math.min(anchor.top - 4, window.innerHeight - height - 8)), left })
      return
    }
    if (side === 'right-bottom') {
      const left = Math.min(anchor.right + 6, window.innerWidth - width - 8)
      setPos({ top: Math.max(8, Math.min(anchor.bottom, window.innerHeight - 8) - height), left })
      return
    }
    let left = align === 'end' ? anchor.right - width : anchor.left
    let top = anchor.bottom + 4
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 4)
    setPos({ top, left })
  }, [anchor, align, side, size])

  useEffect(() => {
    if (autoFocus && !ref.current?.contains(document.activeElement)) {
      ref.current?.focus({ preventScroll: true })
    }
  }, [autoFocus])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target) && !ignore?.contains(target)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (closeOnEscape && e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, ignore, closeOnEscape])

  const panel = (
    <div
      ref={ref}
      role={role}
      tabIndex={autoFocus ? -1 : undefined}
      className={`menu ${className ?? ''}`}
      style={{ top: pos.top, left: pos.left }}
    >
      {children}
    </div>
  )
  return portal ? createPortal(panel, document.body) : panel
}
