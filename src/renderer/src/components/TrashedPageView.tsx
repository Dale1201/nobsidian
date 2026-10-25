import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PageDoc, TrashItem } from '@shared/types'
import { registerScroller, useApp } from '../store'
import { Banner } from './Banner'
import { ConfirmDialog } from './Modal'
import { PageIconView } from './PageIconView'
import { ReadOnlyPage } from './ReadOnlyPage'
import { deleteForeverTitle } from '../lib/trash'

const api = window.api

/** A deleted page, read-only, under a banner offering Restore and Delete forever. */
export function TrashedPageView({
  tabId,
  entry,
  initialScroll,
  theme
}: {
  tabId: string
  entry: string
  initialScroll: number
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const [doc, setDoc] = useState<PageDoc | null>(null)
  const [item, setItem] = useState<TrashItem | null>(null)
  const [confirming, setConfirming] = useState(false)
  const app = useApp.getState
  const scrollRef = useRef<HTMLDivElement>(null)
  const keepScroll = useRef<number | null>(initialScroll || null)

  useEffect(() => registerScroller(tabId, () => scrollRef.current?.scrollTop ?? 0), [tabId])
  useLayoutEffect(() => {
    if (!doc || keepScroll.current === null || !scrollRef.current) return
    scrollRef.current.scrollTop = keepScroll.current
    keepScroll.current = null
  }, [doc])

  useEffect(() => {
    let cancelled = false
    void Promise.all([api.invoke('trash:read', { entry }), api.invoke('trash:list', undefined)])
      .then(([d, items]) => {
        if (cancelled) return
        setDoc(d)
        setItem(items.find((i) => i.entry === entry) ?? null)
      })
      .catch((e) => {
        if (cancelled) return
        useApp.getState().trashEntryGone(entry)
        void useApp.getState().reportError('open', e)
      })
    return () => {
      cancelled = true
    }
  }, [entry])

  return (
    <div className="main">
      <header className="topbar">
        <div className="breadcrumbs">
          {doc && (
            <span className="breadcrumb">
              {doc.meta.icon && (
                <span className="page-icon">
                  <PageIconView icon={doc.meta.icon} size={14} />
                </span>
              )}
              {doc.title || 'Untitled'}
            </span>
          )}
        </div>
      </header>
      <Banner
        tone="danger"
        message="This page is in Trash."
        actions={[
          { label: 'Restore page', onClick: () => void app().restoreTrash(entry) },
          { label: 'Delete from Trash', onClick: () => setConfirming(true) }
        ]}
      />
      <div className="page-scroll" ref={scrollRef}>
        {doc && <ReadOnlyPage doc={doc} theme={theme} />}
      </div>
      {confirming && (
        <ConfirmDialog
          title={deleteForeverTitle(item ?? { title: doc?.title ?? '', pageCount: 1 })}
          message="This can't be undone."
          confirmLabel="Delete forever"
          danger
          onConfirm={() => void app().deleteTrash(entry)}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
