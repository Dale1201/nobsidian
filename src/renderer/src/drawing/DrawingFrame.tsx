import { useEffect, useRef, type ReactNode } from 'react'

/** The drawing editor's window: a bar with Done, then the canvas or an error in its place. */
export function DrawingFrame({
  error,
  busy,
  onDone,
  children
}: {
  error?: string
  busy?: boolean
  onDone: () => void
  children?: ReactNode
}): React.JSX.Element {
  const doneButton = useRef<HTMLButtonElement>(null)

  // Without a canvas nothing else here takes focus, and Escape is the way out.
  useEffect(() => {
    if (!error) return
    doneButton.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [error, onDone])

  return (
    <div className="drawing-overlay" role="dialog" aria-modal="true" aria-label="Drawing">
      <div className="drawing-bar drag-region">
        <span className="drawing-title">Drawing</span>
        <button
          ref={doneButton}
          className="button-primary drawing-done no-drag"
          disabled={busy}
          onClick={onDone}
        >
          Done
        </button>
      </div>
      <div className="drawing-canvas">
        {error ? <div className="drawing-error">{error}</div> : children}
      </div>
    </div>
  )
}
