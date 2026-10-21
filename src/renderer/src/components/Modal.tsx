import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'

/** A dimmed backdrop with a panel; closes on backdrop click and Escape, traps Tab, restores focus. */
export function Modal({
  onClose,
  className,
  label,
  onPanelMouseDown,
  children
}: {
  onClose: () => void
  className?: string
  label: string
  onPanelMouseDown?: (e: React.MouseEvent) => void
  children: ReactNode
}): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null)

  // Read during render: the search input's autoFocus runs before any effect.
  const [opener] = useState(() => {
    const sel = window.getSelection()
    return {
      el: document.activeElement,
      range: sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null
    }
  })
  useEffect(
    () => () => {
      // StrictMode's simulated unmount keeps the panel in the DOM; only a real one removes it.
      queueMicrotask(() => {
        const { el, range } = opener
        if (panel.current?.isConnected) return
        if (!(el instanceof HTMLElement) || !el.isConnected) return
        el.focus()
        if (range && el.isContentEditable) {
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
        }
      })
    },
    [opener]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const trapTab = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.tabIndex >= 0 && !el.hasAttribute('disabled')
    )
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !panel.current.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !panel.current.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        className={`modal ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={trapTab}
        onMouseDown={onPanelMouseDown}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

/** A small "are you sure" dialog with a destructive or primary confirm button. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose
}: {
  title: string
  message?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal onClose={onClose} className="confirm" label={title}>
      <div className="confirm-title">{title}</div>
      {message && <div className="confirm-message">{message}</div>}
      <div className="confirm-actions">
        <button
          className={danger ? 'button-danger' : 'button-primary'}
          autoFocus
          onClick={() => {
            onClose()
            onConfirm()
          }}
        >
          {confirmLabel}
        </button>
        <button className="button-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
