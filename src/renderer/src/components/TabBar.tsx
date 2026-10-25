import { useEffect, useRef, useState } from 'react'
import type { PageNode } from '@shared/types'
import { activeTab, currentEntry, nearest, type Tab } from '../lib/tabs'
import { findNode } from '../lib/tree'
import { useApp } from '../store'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlusIcon, SidebarIcon } from './icons'
import { PageIconView } from './PageIconView'

const api = window.api

function tabLabel(tab: Tab, tree: PageNode[]): { title: string; icon?: string } {
  const entry = currentEntry(tab)
  if (entry.kind === 'trash') return { title: entry.title || 'Untitled', icon: entry.icon }
  const node = findNode(tree, entry.pageId)
  return { title: node?.title || 'Untitled', icon: node?.icon }
}

function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => api.on('window:fullscreen', setFullscreen), [])
  return fullscreen
}

/** The window's top row: traffic lights, sidebar toggle, back and forward, tabs and the new tab button. */
export function TabBar(): React.JSX.Element {
  const state = useApp((s) => s.tabs)
  const tree = useApp((s) => s.tree)
  const collapsed = useApp((s) => s.settings?.sidebarCollapsed ?? false)
  const width = useApp((s) => s.sidebarDrag ?? s.settings?.sidebarWidth ?? 240)
  const fullscreen = useFullscreen()
  const app = useApp.getState
  const listRef = useRef<HTMLDivElement>(null)

  const usable = (e: Tab['entries'][number]): boolean =>
    e.kind === 'trash' || findNode(tree, e.pageId) !== null
  const tab = state ? activeTab(state) : null
  const canBack = tab !== null && nearest(tab, -1, usable) !== null
  const canForward = tab !== null && nearest(tab, 1, usable) !== null

  useEffect(() => {
    listRef.current
      ?.querySelector('.tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [state?.activeId, state?.tabs.length])

  const tabs = state?.tabs ?? []

  return (
    <header
      className={[
        'tab-bar drag-region',
        collapsed ? 'sidebar-collapsed' : '',
        fullscreen ? 'fullscreen' : ''
      ].join(' ')}
    >
      <div
        className="tab-bar-lead"
        style={{
          width: collapsed ? undefined : width,
          paddingLeft: fullscreen ? 12 : api.windowControls.inset
        }}
      >
        <button
          className="tab-bar-button no-drag"
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          onClick={() => void app().updateSettings({ sidebarCollapsed: !collapsed })}
        >
          <SidebarIcon size={20} />
        </button>
      </div>
      <div className="tab-bar-nav">
        <button
          className="tab-bar-button no-drag"
          aria-label="Back"
          title="Back"
          disabled={!canBack}
          onClick={() => app().back()}
        >
          <ChevronLeftIcon size={20} />
        </button>
        <button
          className="tab-bar-button no-drag"
          aria-label="Forward"
          title="Forward"
          disabled={!canForward}
          onClick={() => app().forward()}
        >
          <ChevronRightIcon size={20} />
        </button>
      </div>
      <div
        className="tab-list"
        ref={listRef}
        role="tablist"
        onWheel={(e) => {
          if (e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        <div className="tab-strip" style={{ maxWidth: tabs.length * 200 + 40 }}>
          {tabs.map((t, i) => {
            const { title, icon } = tabLabel(t, tree)
            const active = t.id === state?.activeId
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={active}
                aria-label={title}
                title={title}
                data-testid={`tab-${title}`}
                className={[
                  'tab no-drag',
                  active ? 'active' : '',
                  i === tabs.length - 1 ? 'last' : ''
                ].join(' ')}
                onPointerDown={(e) => {
                  if (e.button === 0 && !(e.target as Element).closest('.tab-close'))
                    app().activateTab(t.id)
                }}
                onMouseDown={(e) => {
                  if (e.button === 1) e.preventDefault()
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) app().closeTab(t.id)
                }}
              >
                <span className="tab-icon">
                  <PageIconView icon={icon} size={14} />
                </span>
                <span className="tab-title">{title}</span>
                <span className="tab-close">
                  <button
                    aria-label={`Close ${title}`}
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation()
                      app().closeTab(t.id)
                    }}
                  >
                    <CloseIcon size={16} />
                  </button>
                </span>
              </div>
            )
          })}
          <div className="tab-bar-new">
            <button
              className="tab-bar-button no-drag"
              aria-label="New tab"
              title="New tab"
              onClick={() => app().newTab()}
            >
              <PlusIcon size={20} />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
