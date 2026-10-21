import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PageDoc, PageMetaPatch } from '@shared/types'
import { findNode } from '../lib/tree'
import { useApp } from '../store'
import { Banner } from './Banner'
import { PageCover, PageIconAndControls } from './PageHeader'
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

export function PageView({ theme }: { theme: 'light' | 'dark' }): React.JSX.Element {
  const currentId = useApp((s) => s.currentId)
  const node = useApp((s) => (s.currentId ? findNode(s.tree, s.currentId) : null))
  const [doc, setDoc] = useState<PageDoc | null>(null)
  // Bumped to rebuild the editor from a fresh read of the file.
  const [generation, setGeneration] = useState(0)
  const [conflict, setConflict] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<PageEditorHandle>(null)
  const keepScroll = useRef<number | null>(null)
  const docRef = useRef(doc)
  useLayoutEffect(() => {
    docRef.current = doc
  })
  const onConflict = useCallback(() => setConflict(true), [])

  useEffect(() => {
    if (!currentId) return
    let cancelled = false
    void api.invoke('page:read', { id: currentId }).then((d) => {
      if (cancelled) return
      setDoc(d)
      setConflict(false)
    })
    return () => {
      cancelled = true
    }
  }, [currentId])

  const reload = useCallback(async (): Promise<void> => {
    const id = docRef.current?.id
    if (!id) return
    const fresh = await api.invoke('page:read', { id })
    if (docRef.current?.id !== id || useApp.getState().currentId !== id) return
    // Typing that started while the page was being read is not thrown away.
    if (editorRef.current?.hasUnsaved()) return setConflict(true)
    keepScroll.current = scrollRef.current?.scrollTop ?? null
    setDoc(fresh)
    setGeneration((g) => g + 1)
    setConflict(false)
  }, [])

  useLayoutEffect(() => {
    if (keepScroll.current !== null && scrollRef.current) {
      scrollRef.current.scrollTop = keepScroll.current
      keepScroll.current = null
    }
  }, [generation])

  useEffect(
    () =>
      window.api.on('page:changed', ({ id, revision }) => {
        const current = docRef.current
        if (!current || current.id !== id) return
        if (revision <= (editorRef.current?.revision() ?? current.revision)) return
        if (editorRef.current?.hasUnsaved()) setConflict(true)
        else void reload()
      }),
    [reload]
  )

  const updateMeta = (patch: PageMetaPatch): void => {
    if (!doc) return
    setDoc(applyPatch(doc, patch))
    void api.invoke('page:meta', { id: doc.id, patch })
  }

  const ready = doc && doc.id === currentId && node

  return (
    <div className="main">
      <TopBar
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
              <PageEditor
                key={`${doc.id}:${generation}`}
                ref={editorRef}
                doc={doc}
                theme={theme}
                onConflict={onConflict}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
