import { useEffect } from 'react'
import { HistoryModal } from './components/HistoryModal'
import { PageView } from './components/PageView'
import { SearchModal } from './components/SearchModal'
import { Sidebar } from './components/Sidebar'
import { TrashedPageView } from './components/TrashedPageView'
import { Welcome } from './components/Welcome'
import { toggledPreference, useEffectiveTheme } from './lib/theme'
import { flushAll, useApp } from './store'

const api = window.api

export function App(): React.JSX.Element | null {
  const ready = useApp((s) => s.ready)
  const workspace = useApp((s) => s.workspace)
  const settings = useApp((s) => s.settings)
  const theme = useEffectiveTheme(settings?.theme)
  const error = useApp((s) => s.error)
  const overlay = useApp((s) => s.overlay)
  const trashEntry = useApp((s) => s.trashEntry)

  useEffect(() => {
    void useApp.getState().init()
    const offTree = api.on('tree:changed', (snapshot) => useApp.getState().applySnapshot(snapshot))
    const offFlush = api.on('app:flush', () => {
      void flushAll().finally(() => api.invoke('app:flushed', undefined))
    })
    const offMissing = api.on('workspace:missing', () => useApp.getState().workspaceMissing())
    // Cmd+K opens search unless the editor used it to add a link to selected text.
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'k') return
      if (e.defaultPrevented || !useApp.getState().workspace || useApp.getState().overlay) return
      e.preventDefault()
      useApp.getState().setOverlay({ kind: 'search' })
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offTree()
      offFlush()
      offMissing()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(
    () =>
      api.on('menu:command', (cmd) => {
        const app = useApp.getState()
        if (cmd === 'new-page') void app.createPage(null)
        if (cmd === 'open-folder') void app.chooseWorkspace()
        if (cmd === 'search' && app.workspace && !app.overlay) app.setOverlay({ kind: 'search' })
        if (cmd === 'back') app.back()
        if (cmd === 'forward') app.forward()
        if (cmd === 'toggle-sidebar')
          void app.updateSettings({ sidebarCollapsed: !app.settings?.sidebarCollapsed })
        if (cmd === 'toggle-theme') void app.updateSettings({ theme: toggledPreference(theme) })
      }),
    [theme]
  )

  if (!ready) return null
  return (
    <div className="app">
      {!workspace ? (
        <Welcome />
      ) : (
        <>
          {!settings?.sidebarCollapsed && <Sidebar />}
          {trashEntry ? (
            <TrashedPageView key={trashEntry} entry={trashEntry} theme={theme} />
          ) : (
            <PageView theme={theme} />
          )}
          {overlay?.kind === 'search' && <SearchModal />}
          {overlay?.kind === 'move' && <SearchModal moving={overlay.pageId} />}
          {overlay?.kind === 'history' && <HistoryModal pageId={overlay.pageId} theme={theme} />}
        </>
      )}
      {error && (
        <div className="toast" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
