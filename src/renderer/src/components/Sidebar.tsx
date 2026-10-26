import { useState } from 'react'
import type { TrashItem } from '@shared/types'
import { findNode } from '../lib/tree'
import { deleteForeverTitle } from '../lib/trash'
import { useApp } from '../store'
import { ComposeIcon, PlusIcon, SearchIcon, SettingsIcon, TrashIcon } from './icons'
import { ConfirmDialog } from './Modal'
import { Menu } from './menu/Menu'
import { SidebarRow } from './SidebarRow'
import { TrashPopover } from './TrashPopover'

const MIN_WIDTH = 200
const MAX_WIDTH = 480

export function Sidebar(): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const favorites = useApp((s) => s.favorites)
  const workspace = useApp((s) => s.workspace)
  const savedWidth = useApp((s) => s.settings?.sidebarWidth ?? 240)
  const width = useApp((s) => s.sidebarDrag)
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const [trash, setTrash] = useState<DOMRect | null>(null)
  const [deleting, setDeleting] = useState<TrashItem | null>(null)
  const [trashButton, setTrashButton] = useState<HTMLButtonElement | null>(null)
  const app = useApp.getState

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const start = savedWidth
    let latest = start
    const move = (ev: MouseEvent): void => {
      latest = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, start + ev.clientX - startX))
      app().setSidebarDrag(latest)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void app()
        .updateSettings({ sidebarWidth: latest })
        .then(() => app().setSidebarDrag(null))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const favoriteNodes = favorites.map((id) => findNode(tree, id)).filter((n) => n !== null)

  return (
    <aside className="sidebar" style={{ width: width ?? savedWidth }} data-testid="sidebar">
      <div className="sidebar-workspace-row">
        <button
          className="sidebar-workspace"
          onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
        >
          <span className="sidebar-workspace-badge">
            {workspace?.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar-row-title">{workspace?.name}</span>
        </button>
        <button
          className="icon-button sidebar-compose"
          aria-label="New page"
          title="New page"
          onClick={() => void app().createPage(null)}
        >
          <ComposeIcon size={18} />
        </button>
      </div>
      <div className="sidebar-nav">
        <button className="sidebar-row" onClick={() => app().setOverlay({ kind: 'search' })}>
          <span className="page-icon">
            <SearchIcon size={18} />
          </span>
          <span className="sidebar-row-title">Search</span>
        </button>
      </div>
      <div
        className="sidebar-scroll"
        onDragOver={(e) => {
          const el = e.currentTarget
          const { top, bottom } = el.getBoundingClientRect()
          if (e.clientY < top + 32) el.scrollTop -= 8
          else if (e.clientY > bottom - 32) el.scrollTop += 8
        }}
      >
        {favoriteNodes.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Favorites</div>
            {favoriteNodes.map((node) => (
              <SidebarRow key={node.id} node={node} depth={0} draggable={false} scope="favorites" />
            ))}
          </div>
        )}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Pages</div>
          {tree.map((node) => (
            <SidebarRow key={node.id} node={node} depth={0} />
          ))}
          <button className="sidebar-row sidebar-add" onClick={() => void app().createPage(null)}>
            <span className="page-icon">
              <PlusIcon size={16} />
            </span>
            <span className="sidebar-row-title">New page</span>
          </button>
        </div>
      </div>
      <div className="sidebar-footer">
        <button
          className="sidebar-row"
          onClick={() => app().setOverlay({ kind: 'settings', section: 'preferences' })}
        >
          <span className="page-icon">
            <SettingsIcon size={18} />
          </span>
          <span className="sidebar-row-title">Settings</span>
        </button>
        <button
          ref={setTrashButton}
          className={`sidebar-row ${trash ? 'menu-open' : ''}`}
          onClick={(e) => setTrash(trash ? null : e.currentTarget.getBoundingClientRect())}
        >
          <span className="page-icon">
            <TrashIcon size={18} />
          </span>
          <span className="sidebar-row-title">Trash</span>
        </button>
      </div>
      <div className="sidebar-resize" onMouseDown={startResize} />
      {trash && (
        <TrashPopover
          anchor={trash}
          ignore={trashButton}
          onClose={() => setTrash(null)}
          onDeleteForever={setDeleting}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={deleteForeverTitle(deleting)}
          message="This can't be undone."
          confirmLabel="Delete forever"
          danger
          onConfirm={() => void app().deleteTrash(deleting.entry)}
          onClose={() => {
            setDeleting(null)
            trashButton?.focus()
          }}
        />
      )}
      {menu && (
        <Menu
          anchor={menu}
          onClose={() => setMenu(null)}
          entries={[
            {
              kind: 'item',
              id: 'open-folder',
              label: 'Open another folder…',
              onSelect: () => void app().chooseWorkspace()
            }
          ]}
        />
      )}
    </aside>
  )
}
