import { Fragment, useState } from 'react'
import type { PageDoc } from '@shared/types'
import { findNode, pathTo } from '../lib/tree'
import { useApp } from '../store'
import { ClockIcon, DotsIcon, DuplicateIcon, StarIcon, TrashIcon, WidthIcon } from './icons'
import { Menu } from './menu/Menu'
import { PageIconView } from './PageIconView'

export function TopBar({
  pageId,
  doc,
  onToggleFullWidth
}: {
  pageId: string
  doc: PageDoc | null
  onToggleFullWidth: () => void
}): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const favorites = useApp((s) => s.favorites)
  const currentId = useApp((s) => (findNode(s.tree, pageId) ? pageId : null))
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const app = useApp.getState
  const crumbs = currentId ? pathTo(tree, currentId) : []
  const isFavorite = currentId ? favorites.includes(currentId) : false

  return (
    <header className="topbar">
      <div className="breadcrumbs">
        {crumbs.map((node, i) => (
          <Fragment key={node.id}>
            {i > 0 && <span className="breadcrumb-sep">/</span>}
            <button className="breadcrumb" onClick={() => app().openPage(node.id)}>
              {node.icon && (
                <span className="page-icon">
                  <PageIconView icon={node.icon} size={14} />
                </span>
              )}
              <span className="breadcrumb-title">{node.title || 'Untitled'}</span>
            </button>
          </Fragment>
        ))}
      </div>
      {currentId && (
        <div className="topbar-actions">
          <button
            className={`icon-button ${isFavorite ? 'on' : ''}`}
            aria-label={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
            onClick={() => void app().toggleFavorite(currentId)}
          >
            <StarIcon size={17} filled={isFavorite} />
          </button>
          <button
            className="icon-button"
            aria-label="Page menu"
            onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
          >
            <DotsIcon size={17} />
          </button>
        </div>
      )}
      {menu && currentId && (
        <Menu
          anchor={menu}
          align="end"
          onClose={() => setMenu(null)}
          entries={[
            {
              kind: 'item',
              id: 'full-width',
              label: doc?.meta.fullWidth ? 'Use default width' : 'Full width',
              icon: <WidthIcon size={16} />,
              onSelect: onToggleFullWidth
            },
            { kind: 'separator' },
            {
              kind: 'item',
              id: 'duplicate',
              label: 'Duplicate',
              icon: <DuplicateIcon size={16} />,
              onSelect: () => void app().duplicatePage(currentId)
            },
            {
              kind: 'item',
              id: 'page-history',
              label: 'Page history',
              icon: <ClockIcon size={16} />,
              onSelect: () => app().setOverlay({ kind: 'history', pageId: currentId })
            },
            { kind: 'separator' },
            {
              kind: 'item',
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon size={16} />,
              danger: true,
              onSelect: () => void app().trashPage(currentId)
            }
          ]}
        />
      )}
    </header>
  )
}
