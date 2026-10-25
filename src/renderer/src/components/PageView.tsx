import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PageDoc, PageMetaPatch } from '@shared/types'
import { findNode } from '../lib/tree'
import { emitPageEvent, onPageEvent } from '../lib/pageEvents'
import { registerScroller, useApp } from '../store'
import { Banner } from './Banner'
import { PageCover, PageIconAndControls } from './PageHeader'
import { EditorErrorBoundary } from './EditorErrorBoundary'
import { PageEditor, type PageEditorHandle } from './PageEditor'
import { PageTitle } from './PageTitle'
import { TopBar } from './TopBar'

const api = window.api

function applyPatch(doc: PageDoc, patch: PageMetaPatch): PageDoc {
  const meta = { ...doc.meta }
  if (patch.icon !== undefined) meta.icon = patch.icon ?? undefined
  if (patch.cover !== undefined) meta.cover = patch.cover ?? undefined
  if (patch.coverPosition !== undefined) meta.coverPosition = patch.coverPosition ?? undefined
  if (patch.fullWidth !== undefined) meta.fullWidth = patch.fullWidth
  return { ...doc, meta }
}

export function PageView({
  tabId,
  pageId,
  initialScroll,
  active,
  theme
}: {
  tabId: string
  pageId: string
  /** Where to scroll once the page shows, as when going back to it. */
  initialScroll: number
  active: boolean
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const node = useApp((s) => findNode(s.tree, pageId))
  const [doc, setDoc] = useState<PageDoc | null>(null)
  // Bumped to rebuild the editor from a fresh read of the file.
  const [generation, setGeneration] = useState(0)
  const [conflict, setConflict] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<PageEditorHandle>(null)
  const keepScroll = useRef<number | null>(initialScroll || null)
  const docRef = useRef(doc)
  useLayoutEffect(() => {
    docRef.current = doc
  })
  const onConflict = useCallback(() => setConflict(true), [])

  useEffect(() => {
    let cancelled = false
    void api.invoke('page:read', { id: pageId }).then((d) => {
      if (cancelled) return
      setDoc(d)
      setConflict(false)
    })
    return () => {
      cancelled = true
    }
  }, [pageId])

  useEffect(() => registerScroller(tabId, () => scrollRef.current?.scrollTop ?? 0), [tabId])

  // A tab being left saves at once, so a hidden tab never sits on unsaved typing.
  useEffect(() => {
    if (!active) void editorRef.current?.saveNow()
  }, [active])

  const reload = useCallback(async (): Promise<void> => {
    const id = docRef.current?.id
    if (!id) return
    let fresh: PageDoc
    try {
      fresh = await api.invoke('page:read', { id })
    } catch (e) {
      return useApp.getState().reportError('reload', e)
    }
    if (docRef.current?.id !== id) return
    // Typing that started while the page was being read is not thrown away.
    if (editorRef.current?.hasUnsaved()) {
      editorRef.current.markConflicted()
      return setConflict(true)
    }
    keepScroll.current = scrollRef.current?.scrollTop ?? null
    setDoc(fresh)
    setGeneration((g) => g + 1)
    setConflict(false)
  }, [])

  const ready = doc && doc.id === pageId && node

  useLayoutEffect(() => {
    if (!ready || keepScroll.current === null || !scrollRef.current) return
    scrollRef.current.scrollTop = keepScroll.current
    keepScroll.current = null
  }, [generation, ready])

  useEffect(() => {
    const offOutside = window.api.on('page:changed', ({ id, revision }) => {
      const current = docRef.current
      if (!current || current.id !== id) return
      if (revision <= (editorRef.current?.revision() ?? current.revision)) return
      if (editorRef.current?.hasUnsaved()) setConflict(true)
      else void reload()
    })
    // Icon, cover and width changes made in another tab showing this page.
    const offTabs = onPageEvent((event) => {
      if (event.type === 'meta' && event.id === docRef.current?.id)
        setDoc((d) => (d?.id === event.id ? applyPatch(d, event.patch) : d))
    })
    return () => {
      offOutside()
      offTabs()
    }
  }, [reload])
  const onStale = useCallback(() => void reload(), [reload])

  useEffect(() => {
    useApp.getState().setTabConflict(tabId, Boolean(ready && conflict))
  }, [tabId, ready, conflict])
  useEffect(() => () => useApp.getState().setTabConflict(tabId, false), [tabId])

  const updateMeta = (patch: PageMetaPatch): void => {
    if (!doc) return
    const before = doc
    setDoc(applyPatch(doc, patch))
    emitPageEvent({ type: 'meta', id: doc.id, patch })
    api.invoke('page:meta', { id: doc.id, patch }).catch((e) => {
      setDoc((d) => (d?.id === before.id ? { ...d, meta: before.meta } : d))
      void useApp.getState().reportError('update', e)
    })
  }

  return (
    <div className="main">
      <TopBar
        pageId={pageId}
        doc={ready ? doc : null}
        onToggleFullWidth={() => doc && updateMeta({ fullWidth: !doc.meta.fullWidth })}
      />
      {ready && conflict && (
        <Banner
          tone="warning"
          message="This page was changed outside Nobsidian."
          actions={[
            {
              label: 'Reload',
              onClick: () =>
                void editorRef.current?.discard().then((ok) => (ok ? reload() : undefined))
            },
            {
              label: 'Keep mine',
              onClick: () =>
                void editorRef.current?.keepMine().then((ok) => {
                  if (!ok) return
                  setConflict(false)
                  bodyRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
                })
            }
          ]}
        />
      )}
      {ready && doc.frontmatterError && (
        <Banner
          tone="info"
          message="This page's frontmatter couldn't be read, so it's shown as text."
        />
      )}
      <div className="page-scroll" data-testid="page-scroll" ref={scrollRef}>
        {ready && (
          <>
            <PageCover meta={doc.meta} onChange={updateMeta} />
            <div className={`page-column ${doc.meta.fullWidth ? 'full-width' : ''}`}>
              <div className={`page-header ${doc.meta.cover ? 'has-cover' : ''}`}>
                <PageIconAndControls meta={doc.meta} onChange={updateMeta} />
                <PageTitle
                  key={doc.id}
                  id={doc.id}
                  title={node.title}
                  onEnter={() =>
                    bodyRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
                  }
                />
              </div>
            </div>
            <div
              className={`page-column page-body ${doc.meta.fullWidth ? 'full-width' : ''}`}
              ref={bodyRef}
            >
              <EditorErrorBoundary key={`${doc.id}:${generation}`} path={doc.path}>
                <PageEditor
                  ref={editorRef}
                  doc={doc}
                  theme={theme}
                  active={active}
                  onConflict={onConflict}
                  onStale={onStale}
                />
              </EditorErrorBoundary>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
