import { useEffect, useRef, useState } from 'react'
import type { PageDoc, PageMetaPatch } from '@shared/types'
import { findNode } from '../lib/tree'
import { useApp } from '../store'
import { PageCover, PageIconAndControls } from './PageHeader'
import { PageEditor } from './PageEditor'
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
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!currentId) return
    let cancelled = false
    void api.invoke('page:read', { id: currentId }).then((d) => {
      if (!cancelled) setDoc(d)
    })
    return () => {
      cancelled = true
    }
  }, [currentId])

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
      <div className="page-scroll" data-testid="page-scroll">
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
              <PageEditor key={doc.id} doc={doc} theme={theme} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
