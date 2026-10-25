import { useEffect, useRef, useState } from 'react'
import { currentEntry, type Tab } from '../lib/tabs'
import { useApp } from '../store'
import { PageView } from './PageView'
import { TrashedPageView } from './TrashedPageView'

/** Every tab shown so far stays mounted, hidden while inactive, so it keeps its place and undo. */
export function TabPanes({ theme }: { theme: 'light' | 'dark' }): React.JSX.Element {
  const state = useApp((s) => s.tabs)
  // Panes keep the order they were first shown in: moving a pane's node would reset its scroll.
  const [shown] = useState<string[]>(() => [])
  if (state && !shown.includes(state.activeId)) shown.push(state.activeId)
  const byId = new Map(state?.tabs.map((t) => [t.id, t]))
  return (
    <div className="tab-panes">
      {shown.flatMap((id) => {
        const tab = byId.get(id)
        return tab
          ? [<TabPane key={id} tab={tab} active={id === state?.activeId} theme={theme} />]
          : []
      })}
    </div>
  )
}

function TabPane({
  tab,
  active,
  theme
}: {
  tab: Tab
  active: boolean
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const entry = currentEntry(tab)
  const lastFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (active && lastFocus.current?.isConnected) lastFocus.current.focus({ preventScroll: true })
  }, [active])
  return (
    <div
      className={`tab-pane ${active ? 'active' : ''}`}
      inert={!active}
      onFocus={(e) => {
        lastFocus.current = e.target
      }}
    >
      {entry.kind === 'trash' ? (
        <TrashedPageView
          key={`${tab.index}:${entry.entry}`}
          tabId={tab.id}
          entry={entry.entry}
          initialScroll={entry.scroll}
          theme={theme}
        />
      ) : (
        <PageView
          key={`${tab.index}:${entry.pageId}`}
          tabId={tab.id}
          pageId={entry.pageId}
          initialScroll={entry.scroll}
          active={active}
          theme={theme}
        />
      )}
    </div>
  )
}
