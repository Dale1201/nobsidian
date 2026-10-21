import { useState } from 'react'
import { findNode } from '../lib/tree'
import { useApp } from '../store'
import { ComposeIcon, PlusIcon, SearchIcon, SidebarIcon } from './icons'
import { Menu } from './Popover'
import { SidebarRow } from './SidebarRow'

const MIN_WIDTH = 200
const MAX_WIDTH = 480

export function Sidebar(): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const favorites = useApp((s) => s.favorites)
  const workspace = useApp((s) => s.workspace)
  const savedWidth = useApp((s) => s.settings?.sidebarWidth ?? 240)
  const [width, setWidth] = useState<number | null>(null)
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const app = useApp.getState

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const start = savedWidth
    let latest = start
    const move = (ev: MouseEvent): void => {
      latest = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, start + ev.clientX - startX))
      setWidth(latest)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void app()
        .updateSettings({ sidebarWidth: latest })
        .then(() => setWidth(null))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const favoriteNodes = favorites.map((id) => findNode(tree, id)).filter((n) => n !== null)

  return (
    <aside className="sidebar" style={{ width: width ?? savedWidth }} data-testid="sidebar">
      <div className="sidebar-header drag-region">
        <button
          className="icon-button no-drag"
          aria-label="Hide sidebar"
          onClick={() => void app().updateSettings({ sidebarCollapsed: true })}
        >
          <SidebarIcon size={16} />
        </button>
        <button
          className="icon-button no-drag"
          aria-label="New page"
          onClick={() => void app().createPage(null)}
        >
          <ComposeIcon size={16} />
        </button>
      </div>
      <button
        className="sidebar-workspace"
        onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
      >
        <span className="sidebar-workspace-badge">{workspace?.name.slice(0, 1).toUpperCase()}</span>
        <span className="sidebar-row-title">{workspace?.name}</span>
      </button>
      <div className="sidebar-nav">
        <button className="sidebar-row" onClick={() => app().setOverlay({ kind: 'search' })}>
          <span className="page-icon">
            <SearchIcon size={18} />
          </span>
          <span className="sidebar-row-title">Search</span>
        </button>
      </div>
      <div className="sidebar-scroll">
        {favoriteNodes.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Favorites</div>
            {favoriteNodes.map((node) => (
              <SidebarRow
                key={node.id}
                node={node}
                depth={0}
                draggable={false}
                expandable={false}
              />
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
      <div className="sidebar-resize" onMouseDown={startResize} />
      {menu && (
        <Menu
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[{ label: 'Open another folder…', onSelect: () => void app().chooseWorkspace() }]}
        />
      )}
    </aside>
  )
}
