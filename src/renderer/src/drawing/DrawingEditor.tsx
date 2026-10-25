import '@excalidraw/excalidraw/index.css'

import {
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  exportToSvg,
  hashElementsVersion,
  loadFromBlob
} from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { drawingFileName } from '@shared/core/drawing'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorReason, registerFlusher, useApp } from '../store'
import { DrawingFrame } from './DrawingFrame'
import type { DrawingSession } from './session'

const api = window.api

type Scene = Awaited<ReturnType<typeof loadFromBlob>>
type Loaded = { scene: Scene | null } | { error: string }

async function loadScene(url: string): Promise<Loaded> {
  if (!url) return { scene: null }
  let text: string | null
  try {
    text = await api.invoke('drawing:read', { href: url })
  } catch (err) {
    return { error: `Couldn't open the drawing: ${errorReason(err)}` }
  }
  if (text === null) return { error: 'Drawing not found' }
  try {
    return { scene: await loadFromBlob(new Blob([text], { type: 'image/svg+xml' }), null, null) }
  } catch {
    return { error: "This drawing can't be edited" }
  }
}

export default function DrawingEditor({
  session,
  theme
}: {
  session: DrawingSession
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const excalidraw = useRef<ExcalidrawImperativeAPI | null>(null)
  const savedVersion = useRef(0)
  const url = useRef(session.url)

  useEffect(() => {
    let live = true
    void loadScene(session.url).then((result) => {
      if (!live) return
      if ('scene' in result)
        savedVersion.current = hashElementsVersion(result.scene?.elements ?? [])
      setLoaded(result)
    })
    return () => {
      live = false
    }
  }, [session.url])

  /** Writes the drawing if it changed; false if that failed. */
  const save = useCallback(async (): Promise<boolean> => {
    const draw = excalidraw.current
    if (!draw) return true
    const elements = draw.getSceneElements()
    const version = hashElementsVersion(elements)
    if (version === savedVersion.current) return true
    try {
      const svg = await exportToSvg({
        elements,
        appState: {
          ...draw.getAppState(),
          exportEmbedScene: true,
          exportBackground: true,
          viewBackgroundColor: '#ffffff',
          exportWithDarkMode: false,
          exportScale: 1
        },
        files: draw.getFiles()
      })
      const href = await api.invoke('attachment:save', {
        name: drawingFileName(url.current),
        data: new TextEncoder().encode(svg.outerHTML)
      })
      savedVersion.current = version
      url.current = href
      if (!session.apply(href)) {
        useApp
          .getState()
          .showMessage(`The drawing's block was gone, so it was saved as ${href.slice(1)}.`)
      }
      return true
    } catch (err) {
      useApp.getState().showMessage(`Couldn't save the drawing: ${errorReason(err)}`)
      return false
    }
  }, [session])

  useEffect(() => registerFlusher(save, { first: true }), [save])

  const done = useCallback(async () => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    const saved = await save()
    saving.current = false
    setBusy(false)
    if (saved) session.close()
  }, [save, session])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void done()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [done])

  if (!loaded) return <DrawingFrame busy onDone={() => {}} />
  if ('error' in loaded) return <DrawingFrame error={loaded.error} onDone={() => session.close()} />
  return (
    <DrawingFrame busy={busy} onDone={() => void done()}>
      <Excalidraw
        excalidrawAPI={(a) => (excalidraw.current = a)}
        initialData={{
          elements: loaded.scene?.elements ?? [],
          files: loaded.scene?.files,
          appState: { viewBackgroundColor: '#ffffff' },
          scrollToContent: true
        }}
        theme={theme}
        autoFocus
        aiEnabled={false}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            export: false,
            loadScene: false,
            saveAsImage: false,
            saveToActiveFile: false,
            toggleTheme: null
          }
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
        <WelcomeScreen>
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.HelpHint />
        </WelcomeScreen>
      </Excalidraw>
    </DrawingFrame>
  )
}
