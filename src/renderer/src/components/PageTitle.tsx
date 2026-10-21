import { useCallback, useEffect, useRef } from 'react'
import { registerFlusher, useApp } from '../store'

const RENAME_DELAY_MS = 400

/** Big editable title; renames the page file shortly after typing stops. */
export function PageTitle({
  id,
  title,
  onEnter
}: {
  id: string
  title: string
  onEnter: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLHeadingElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(title)
  // The last title sent to the main process; snapshots echoing older renames are ignored.
  const committed = useRef(title)

  const commit = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (latest.current === committed.current) return Promise.resolve()
    committed.current = latest.current
    return useApp.getState().renamePage(id, latest.current)
  }, [id])

  useEffect(() => {
    if (ref.current) ref.current.textContent = latest.current
    // A brand-new page starts with the cursor in its title, like Notion.
    if (latest.current === '') ref.current?.focus()
    const unregister = registerFlusher(() => commit().then(() => true))
    return () => {
      unregister()
      void commit()
    }
  }, [commit])

  useEffect(() => {
    const el = ref.current
    if (!el || timer.current || title === committed.current || document.activeElement === el) return
    // Renamed elsewhere (sidebar, or a failed rename being reverted).
    latest.current = title
    committed.current = title
    el.textContent = title
  }, [title])

  return (
    <h1
      ref={ref}
      className="page-title"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      data-placeholder="Untitled"
      data-testid="page-title"
      onInput={(e) => {
        latest.current = (e.currentTarget.textContent ?? '').replace(/\n/g, ' ')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void commit(), RENAME_DELAY_MS)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void commit()
          onEnter()
        }
      }}
    />
  )
}
