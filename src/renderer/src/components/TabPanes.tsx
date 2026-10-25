import { useState } from 'react'
import { currentEntry, type Tab } from '../lib/tabs'
import { useApp } from '../store'
import { PageView } from './PageView'
import { TrashedPageView } from './TrashedPageView'

/** Every tab shown so far stays mounted, hidden while inactive, so it keeps its place and undo. */
export function TabPanes({ theme }: { theme: 'light' | 'dark' }): React.JSX.Element {
  const state = useApp((s) => s.tabs)
  const [shown] = useState(() => new Set<string>())
  if (state) shown.add(state.activeId)
  return (
    <div className="tab-panes">
      {state?.tabs
        .filter((t) => shown.has(t.id))
        .map((tab) => (
          <TabPane key={tab.id} tab={tab} active={tab.id === state.activeId} theme={theme} />
        ))}
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
  return (
    <div className={`tab-pane ${active ? 'active' : ''}`} inert={!active}>
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
