import { useEffect, useRef } from 'react'
import { useApp } from '../store'

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

  useEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.textContent !== title) el.textContent = title
    latest.current = title
  }, [title])

  // A brand-new page starts with the cursor in its title, like Notion.
  useEffect(() => {
    if (latest.current === '') ref.current?.focus()
  }, [id])

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        void useApp.getState().renamePage(id, latest.current)
      }
    },
    [id]
  )

  const commit = (): void => {
    timer.current = null
    void useApp.getState().renamePage(id, latest.current)
  }

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
        timer.current = setTimeout(commit, RENAME_DELAY_MS)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (timer.current) {
            clearTimeout(timer.current)
            commit()
          }
          onEnter()
        }
      }}
    />
  )
}
