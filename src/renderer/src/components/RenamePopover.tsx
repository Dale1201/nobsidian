import { useState } from 'react'
import { findNode } from '../lib/tree'
import { useApp } from '../store'
import { Popover } from './Popover'

/** Renames a page in place; Enter or a click outside saves, Escape cancels. */
export function RenamePopover({
  anchor,
  pageId,
  onClose
}: {
  anchor: DOMRect
  pageId: string
  onClose: () => void
}): React.JSX.Element {
  const [title] = useState(() => findNode(useApp.getState().tree, pageId)?.title ?? '')
  const [value, setValue] = useState(title)
  const done = (save: boolean): void => {
    onClose()
    if (save && value !== title) void useApp.getState().renamePage(pageId, value)
  }
  return (
    <Popover
      anchor={anchor}
      closeOnEscape={false}
      onClose={() => done(true)}
      className="rename-popover"
    >
      <input
        className="menu-search rename-popover-input"
        aria-label="Page title"
        placeholder="Untitled"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') done(true)
          if (e.key === 'Escape') {
            e.stopPropagation()
            done(false)
          }
        }}
      />
    </Popover>
  )
}
