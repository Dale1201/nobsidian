import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { PageNode } from '@shared/types'
import { dropTarget, type DropPosition } from '../lib/tree'
import { useApp } from '../store'
import {
  ChevronRightIcon,
  DotsIcon,
  DuplicateIcon,
  MoveIcon,
  PlusIcon,
  RenameIcon,
  StarIcon,
  TrashIcon
} from './icons'
import { Menu } from './menu/Menu'
import { PageIconView } from './PageIconView'

const DRAG_TYPE = 'application/x-nobsidian-page'
// Selectors must return stable references, or zustand re-renders forever.
const NONE: string[] = []

export function SidebarRow({
  node,
  depth,
  draggable = true,
  expandable = true,
  scope = 'pages'
}: {
  node: PageNode
  depth: number
  draggable?: boolean
  expandable?: boolean
  /** Favorites keep their own expansion, apart from the page tree. */
  scope?: 'pages' | 'favorites'
}): React.JSX.Element {
  // A trashed page on screen is not in the sidebar, so no row is the current one.
  const currentId = useApp((s) => (s.trashEntry ? null : s.currentId))
  const expandedIds = useApp((s) => (s.workspace && s.settings?.expanded[s.workspace.root]) || NONE)
  const favorites = useApp((s) => s.favorites)
  const renamingId = useApp((s) => s.renamingId)
  const app = useApp.getState
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const [drop, setDrop] = useState<DropPosition | null>(null)

  const rowRef = useRef<HTMLDivElement>(null)
  const isCurrent = currentId === node.id
  useEffect(() => {
    if (isCurrent) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [isCurrent])

  const expandKey = scope === 'favorites' ? `fav:${node.id}` : node.id
  const expanded = expandable && expandedIds.includes(expandKey)
  const isFavorite = favorites.includes(node.id)
  const indent = 6 + depth * 14

  const positionFor = (e: DragEvent<HTMLDivElement>): DropPosition => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    if (y < rect.height * 0.25) return 'before'
    if (y > rect.height * 0.75) return 'after'
    return 'inside'
  }

  return (
    <>
      <div
        ref={rowRef}
        className={[
          'sidebar-row',
          isCurrent ? 'active' : '',
          menu ? 'menu-open' : '',
          drop ? `drop-${drop}` : ''
        ].join(' ')}
        style={{ paddingLeft: indent }}
        data-testid={`sidebar-row-${node.title || 'Untitled'}`}
        draggable={draggable && renamingId !== node.id}
        onClick={() => app().openPage(node.id)}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, node.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          if (!draggable || !e.dataTransfer.types.includes(DRAG_TYPE)) return
          e.preventDefault()
          setDrop(positionFor(e))
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault()
          setDrop(null)
          const dragged = e.dataTransfer.getData(DRAG_TYPE)
          const target = dragged && dropTarget(app().tree, dragged, node.id, positionFor(e))
          if (target) void app().movePage(dragged, target.parentId, target.index)
        }}
      >
        {/* Like Notion, the page icon turns into the expand arrow on hover. */}
        <span className={`sidebar-row-lead ${expandable ? 'expandable' : ''}`}>
          <span className="page-icon">
            <PageIconView icon={node.icon} />
          </span>
          {expandable && (
            <button
              className="icon-button sidebar-row-toggle"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              onClick={(e) => {
                e.stopPropagation()
                void app().setExpanded(expandKey, !expanded)
              }}
            >
              <ChevronRightIcon size={12} className={`toggle-arrow ${expanded ? 'open' : ''}`} />
            </button>
          )}
        </span>
        {renamingId === node.id ? (
          <RenameInput node={node} />
        ) : (
          <span className="sidebar-row-title">{node.title || 'Untitled'}</span>
        )}
        <span className="sidebar-row-actions">
          <button
            className="icon-button"
            aria-label="Page actions"
            onClick={(e) => {
              e.stopPropagation()
              setMenu(e.currentTarget.getBoundingClientRect())
            }}
          >
            <DotsIcon size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Add a page inside"
            onClick={(e) => {
              e.stopPropagation()
              void app().createPage(node.id)
            }}
          >
            <PlusIcon size={14} />
          </button>
        </span>
      </div>
      {menu && (
        <Menu
          anchor={menu}
          onClose={() => setMenu(null)}
          entries={[
            {
              kind: 'item',
              id: 'favorite',
              label: isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
              icon: <StarIcon size={16} filled={isFavorite} />,
              onSelect: () => void app().toggleFavorite(node.id)
            },
            { kind: 'separator' },
            {
              kind: 'item',
              id: 'duplicate',
              label: 'Duplicate',
              icon: <DuplicateIcon size={16} />,
              onSelect: () => void app().duplicatePage(node.id)
            },
            {
              kind: 'item',
              id: 'rename',
              label: 'Rename',
              icon: <RenameIcon size={16} />,
              onSelect: () => app().setRenaming(node.id)
            },
            {
              kind: 'item',
              id: 'move',
              label: 'Move to',
              icon: <MoveIcon size={16} />,
              onSelect: () => app().setOverlay({ kind: 'move', pageId: node.id })
            },
            { kind: 'separator' },
            {
              kind: 'item',
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon size={16} />,
              danger: true,
              onSelect: () => void app().trashPage(node.id)
            }
          ]}
        />
      )}
      {expanded &&
        (node.children.length ? (
          node.children.map((child) => (
            <SidebarRow
              key={child.id}
              node={child}
              depth={depth + 1}
              scope={scope}
              draggable={draggable}
            />
          ))
        ) : (
          <div className="sidebar-empty" style={{ paddingLeft: indent + 14 + 28 }}>
            No pages inside
          </div>
        ))}
    </>
  )
}

function RenameInput({ node }: { node: PageNode }): React.JSX.Element {
  const [value, setValue] = useState(node.title)
  const done = (commit: boolean): void => {
    useApp.getState().setRenaming(null)
    if (commit && value !== node.title) void useApp.getState().renamePage(node.id, value)
  }
  return (
    <input
      className="rename-input"
      autoFocus
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(true)
        if (e.key === 'Escape') done(false)
      }}
    />
  )
}
