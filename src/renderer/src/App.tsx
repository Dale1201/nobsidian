import { useEffect } from 'react'
import type { MenuCommand } from '@shared/ipc'
import { useAi } from './ai/aiStore'
import { DrawingHost } from './drawing/DrawingHost'
import { FIND_EVENT } from './components/FindBar'
import { HistoryModal } from './components/HistoryModal'
import { ImportDrop } from './components/ImportDrop'
import { ImportPanel } from './components/ImportPanel'
import { SearchModal } from './components/SearchModal'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { TabPanes } from './components/TabPanes'
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
  const editable = el?.closest('[contenteditable="true"]')
  return !!selection && !selection.isCollapsed && !!editable?.closest('.tab-pane.active')
}

export function App(): React.JSX.Element | null {
  const ready = useApp((s) => s.ready)
  const workspace = useApp((s) => s.workspace)
  const settings = useApp((s) => s.settings)
  const theme = useEffectiveTheme(settings?.theme)
  const error = useApp((s) => s.error)
  const overlay = useApp((s) => s.overlay)

  useEffect(() => {
    void useApp.getState().init()
    void useAi.getState().refresh()
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

  useEffect(() => {
    const run = (cmd: MenuCommand): void => {
      const app = useApp.getState()
      // The drawing editor covers the window; only the theme may change under it.
      if (app.overlay?.kind === 'drawing' && cmd !== 'toggle-theme') return
      if (cmd === 'new-page') void app.createPage(null)
      if (cmd === 'open-folder') void app.chooseWorkspace()
      if (cmd === 'import-notion') void app.startImport()
      if (cmd === 'search' && canSearch()) app.setOverlay({ kind: 'search' })
      if (cmd === 'settings' && canSearch())
        app.setOverlay({ kind: 'settings', section: 'preferences' })
      if (cmd === 'back') app.back()
      if (cmd === 'forward') app.forward()
      if (cmd === 'new-tab') app.newTab()
      if (cmd === 'close-tab') {
        if (app.tabs) app.closeTab(app.tabs.activeId)
        else void api.invoke('window:close', undefined)
      }
      if (cmd === 'reopen-tab') app.reopenClosedTab()
      if (cmd === 'next-tab') app.stepTab(1)
      if (cmd === 'previous-tab') app.stepTab(-1)
      if (cmd.startsWith('select-tab-')) app.selectTab(Number(cmd.slice('select-tab-'.length)))
      if (cmd === 'toggle-sidebar')
        void app.updateSettings({ sidebarCollapsed: !app.settings?.sidebarCollapsed })
      if (cmd === 'toggle-theme') void app.updateSettings({ theme: toggledPreference(theme) })
      if (cmd.startsWith('find') && !app.overlay)
        window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: cmd }))
    }
    const offMenu = api.on('menu:command', run)
    // A mouse's side buttons arrive as buttons 3 and 4.
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button !== 3 && e.button !== 4) return
      e.preventDefault()
      run(e.button === 3 ? 'back' : 'forward')
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      offMenu()
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [theme])

  if (!ready) return null
  return (
    <div className="app">
      {!workspace ? (
        <Welcome />
      ) : (
        <>
          {/* The drawing editor covers the window; nothing under it may take focus or clicks. */}
          <div className="app-content" inert={overlay?.kind === 'drawing'}>
            <TabBar />
            <div className="app-body">
              {!settings?.sidebarCollapsed && <Sidebar />}
              <TabPanes theme={theme} />
            </div>
            {overlay?.kind === 'search' && <SearchModal />}
            {overlay?.kind === 'settings' && <SettingsModal section={overlay.section} />}
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
