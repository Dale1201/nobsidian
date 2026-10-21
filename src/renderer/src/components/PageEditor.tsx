import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Block } from '@shared/core/blocks'
import { pageIdFromHref, pageLinkHref } from '@shared/core/links'
import { openHref } from '../lib/navigation'
import type { PageDoc } from '@shared/types'
import { codeBlockOptions } from '@blocknote/code-block'
import { Editor } from '../editor/Editor'
import { createLanguageResolver, withEditorLanguages } from '../editor/codeLanguages'
import type { AppBlock, AppPartialBlock, PageLinkContextValue } from '../editor/schema'
import { resolveAssetUrl } from '../lib/assets'
import { findNode } from '../lib/tree'
import { registerFlusher, useApp } from '../store'

const SAVE_DELAY_MS = 500
const editorLanguage = createLanguageResolver(codeBlockOptions.supportedLanguages)
const api = window.api

export function PageEditor({
  doc,
  theme
}: {
  doc: PageDoc
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const pending = useRef<Block[] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tree = useApp((s) => s.tree)

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const blocks = pending.current
    pending.current = null
    if (blocks) await api.invoke('page:write', { id: doc.id, blocks })
  }, [doc.id])

  useEffect(() => {
    const unregister = registerFlusher(flush)
    return () => {
      unregister()
      void flush()
    }
  }, [flush])

  const onChange = useCallback(
    (blocks: AppBlock[]) => {
      pending.current = blocks as unknown as Block[]
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush]
  )

  const initialBlocks = useMemo(
    () => withEditorLanguages(doc.blocks, editorLanguage) as unknown as AppPartialBlock[],
    [doc.blocks]
  )

  const pageLink = useMemo<PageLinkContextValue>(
    () => ({
      resolve: (href) => {
        const id = pageIdFromHref(href)
        const node = id ? findNode(tree, id) : null
        return node ? { title: node.title || 'Untitled', icon: node.icon } : null
      },
      open: openHref
    }),
    [tree]
  )

  return (
    <Editor
      initialBlocks={initialBlocks}
      theme={theme}
      onChange={onChange}
      uploadFile={async (file) =>
        api.invoke('attachment:save', {
          name: file.name,
          data: new Uint8Array(await file.arrayBuffer())
        })
      }
      resolveFileUrl={async (url) => resolveAssetUrl(url)}
      createSubPage={async () => {
        await flush()
        const node = await api.invoke('page:create', { parentId: doc.id })
        void useApp.getState().setExpanded(doc.id, true)
        return pageLinkHref(node.id)
      }}
      openLink={openHref}
      pageLink={pageLink}
    />
  )
}
