import { useEffect } from 'react'
import { PageView } from './components/PageView'
import { Sidebar } from './components/Sidebar'
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

  useEffect(() => {
    void useApp.getState().init()
    const offTree = api.on('tree:changed', (snapshot) => useApp.getState().applySnapshot(snapshot))
    const offFlush = api.on('app:flush', () => {
      void flushAll().finally(() => api.invoke('app:flushed', undefined))
    })
    const offMissing = api.on('workspace:missing', () => useApp.getState().workspaceMissing())
    return () => {
      offTree()
      offFlush()
      offMissing()
    }
  }, [])

  useEffect(
    () =>
      api.on('menu:command', (cmd) => {
        const app = useApp.getState()
        if (cmd === 'new-page') void app.createPage(null)
        if (cmd === 'open-folder') void app.chooseWorkspace()
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
          <PageView theme={theme} />
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
