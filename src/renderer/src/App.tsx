import { useEffect } from 'react'
import { DrawingHost } from './drawing/DrawingHost'
import { HistoryModal } from './components/HistoryModal'
import { ImportDrop } from './components/ImportDrop'
import { ImportPanel } from './components/ImportPanel'
import { PageView } from './components/PageView'
import { SearchModal } from './components/SearchModal'
import { Sidebar } from './components/Sidebar'
import { TrashedPageView } from './components/TrashedPageView'
import { Welcome } from './components/Welcome'
import { toggledPreference, useEffectiveTheme } from './lib/theme'
import { flushAll, useApp } from './store'

const api = window.api

function canSearch(): boolean {
  const { workspace, overlay, confirms } = useApp.getState()
  return workspace !== null && overlay === null && confirms === 0
}

// Cmd+K on selected text is the editor's link shortcut, even before its toolbar has appeared.
function editorHasSelection(): boolean {
  const selection = window.getSelection()
  const node = selection?.anchorNode
  const el = node instanceof Element ? node : node?.parentElement
  return !!selection && !selection.isCollapsed && !!el?.closest('[contenteditable="true"]')
}

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
      void flushAll()
        .catch(() => false)
        .then((saved) => api.invoke('app:flushed', { saved }))
    })
    const offMissing = api.on('workspace:missing', () => useApp.getState().workspaceMissing())
    const offImport = api.on('import:status', (status) => useApp.getState().setImportStatus(status))
    // Cmd+K opens search unless the editor used it to add a link to selected text.
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'k') return
      if (e.defaultPrevented || !canSearch() || editorHasSelection()) return
      e.preventDefault()
      useApp.getState().setOverlay({ kind: 'search' })
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offTree()
      offFlush()
      offMissing()
      offImport()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(
    () =>
      api.on('menu:command', (cmd) => {
        const app = useApp.getState()
        // The drawing editor covers the window; only the theme may change under it.
        if (app.overlay?.kind === 'drawing' && cmd !== 'toggle-theme') return
        if (cmd === 'new-page') void app.createPage(null)
        if (cmd === 'open-folder') void app.chooseWorkspace()
        if (cmd === 'import-notion') void app.startImport()
        if (cmd === 'search' && canSearch()) app.setOverlay({ kind: 'search' })
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
          {/* The drawing editor covers the window; nothing under it may take focus or clicks. */}
          <div className="app-content" inert={overlay?.kind === 'drawing'}>
            {!settings?.sidebarCollapsed && <Sidebar />}
            {trashEntry ? (
              <TrashedPageView key={trashEntry} entry={trashEntry} theme={theme} />
            ) : (
              <PageView theme={theme} />
            )}
            {overlay?.kind === 'search' && <SearchModal />}
            {overlay?.kind === 'move' && <SearchModal moving={overlay.pageId} />}
            {overlay?.kind === 'history' && <HistoryModal pageId={overlay.pageId} theme={theme} />}
            <ImportDrop />
            <ImportPanel />
          </div>
          {overlay?.kind === 'drawing' && <DrawingHost session={overlay.session} theme={theme} />}
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
