import { useEffect, useState } from 'react'
import { findRanges } from '@shared/core/text'
import type { TrashItem } from '@shared/types'
import { timeAgo } from '../lib/time'
import { useApp } from '../store'
import { RestoreIcon, SearchIcon, TrashIcon } from './icons'
import { PageIconView } from './PageIconView'
import { Popover } from './Popover'

const api = window.api

/** Notion's Trash: deleted pages, filterable, each restorable or deletable for good. */
export function TrashPopover({
  anchor,
  ignore,
  onClose,
  onDeleteForever
}: {
  anchor: DOMRect
  ignore?: Element | null
  onClose: () => void
  onDeleteForever: (item: TrashItem) => void
}): React.JSX.Element {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [query, setQuery] = useState('')
  const app = useApp.getState
  const open = (entry: string): void => {
    onClose()
    app().showTrashEntry(entry)
  }

  useEffect(() => {
    void api
      .invoke('trash:list', undefined)
      .then(setItems)
      .catch(() => setItems([]))
  }, [])

  const terms = query.trim().split(/\s+/).filter(Boolean)
  const shown = (items ?? []).filter((item) =>
    terms.every((t) => findRanges(item.title || 'Untitled', [t]).length > 0)
  )

  return (
    <Popover
      anchor={anchor}
      ignore={ignore}
      onClose={onClose}
      className="trash-popover"
      side="right-bottom"
    >
      <div className="trash-search">
        <SearchIcon size={16} />
        <input
          autoFocus
          placeholder="Search pages in Trash"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="trash-list">
        {shown.map((item) => (
          <div
            key={item.entry}
            className="trash-item"
            role="button"
            data-testid={`trash-item-${item.title || 'Untitled'}`}
            tabIndex={0}
            onClick={() => open(item.entry)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
              e.preventDefault()
              open(item.entry)
            }}
          >
            <span className="page-icon">
              <PageIconView icon={item.icon} />
            </span>
            <span className="trash-item-body">
              <span className="trash-item-title">{item.title || 'Untitled'}</span>
              <span className="trash-item-meta">
                {item.parentTitle ?? 'Top level'} · {timeAgo(item.deletedAt)}
              </span>
            </span>
            <button
              className="icon-button"
              aria-label="Restore"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
                void app().restoreTrash(item.entry)
              }}
            >
              <RestoreIcon size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Delete forever"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
                onDeleteForever(item)
              }}
            >
              <TrashIcon size={16} />
            </button>
          </div>
        ))}
        {items && shown.length === 0 && (
          <div className="trash-empty">{items.length ? 'No matches' : 'No pages in Trash'}</div>
        )}
      </div>
      <div className="trash-footer">Pages in Trash for over 30 days are deleted automatically.</div>
    </Popover>
  )
}
