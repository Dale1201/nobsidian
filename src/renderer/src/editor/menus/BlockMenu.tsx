import { SideMenuExtension } from '@blocknote/core/extensions'
import { useEditorDOMElement, useExtension } from '@blocknote/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAiAccess } from '../../ai/useAiAccess'
import { Menu } from '../../components/menu/Menu'
import { setPageIcon } from '../../components/pageActions'
import { IconPickerPopover } from '../../components/PageHeader'
import { RenamePopover } from '../../components/RenamePopover'
import { blocksOf } from '../blockActions'
import { selectBlocks } from '../blockSelection'
import { targetBlockIds } from '../notionKeys'
import { useAppEditor } from '../useAppEditor'
import { BlockMenuContext, type BlockMenuApi } from './blockMenuContext'
import { blockLabel, blockMenuEntries } from './entries'

export function BlockMenuHost({
  pageId,
  children
}: {
  pageId?: string
  children: ReactNode
}): React.JSX.Element {
  const editor = useAppEditor()
  const sideMenu = useExtension(SideMenuExtension)
  const ai = useAiAccess()
  const [state, setState] = useState<{ ids: string[]; anchor: DOMRect } | null>(null)
  const [panel, setPanel] = useState<{
    kind: 'icon' | 'rename'
    pageId: string
    anchor: DOMRect
  } | null>(null)

  const api = useMemo<BlockMenuApi>(
    () => ({
      open: (ids, anchor) => {
        sideMenu.freezeMenu()
        selectBlocks(editor, ids)
        setState({ ids, anchor })
      }
    }),
    [editor, sideMenu]
  )

  const dom = useEditorDOMElement()
  useEffect(() => {
    // Capture phase, before ProseMirror sees the key.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || !e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
      const ids = targetBlockIds(editor)
      const el = dom?.querySelector(`.bn-block-outer[data-id="${ids[0]}"] .bn-block-content`)
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      const r = el.getBoundingClientRect()
      api.open(ids, new DOMRect(r.left, r.top, 0, Math.min(r.height, 30)))
    }
    dom?.addEventListener('keydown', onKey, true)
    return () => dom?.removeEventListener('keydown', onKey, true)
  }, [dom, editor, api])

  const close = (): void => {
    setState(null)
    sideMenu.unfreezeMenu()
    selectBlocks(editor, [])
    editor.focus()
  }

  const openPanel = (kind: 'icon' | 'rename', target: string, blockId: string): void => {
    const el = dom?.querySelector(`.bn-block-outer[data-id="${blockId}"] .nb-page-link`)
    const anchor = el?.getBoundingClientRect() ?? state?.anchor
    if (anchor) setPanel({ kind, pageId: target, anchor })
  }

  const blocks = state ? blocksOf(editor, state.ids) : []
  return (
    <BlockMenuContext.Provider value={api}>
      {children}
      {state && blocks.length > 0 && (
        <Menu
          anchor={state.anchor}
          entries={blockMenuEntries(editor, blocks, {
            pageId,
            ai,
            editIcon: (target, blockId) => openPanel('icon', target, blockId),
            rename: (target, blockId) => openPanel('rename', target, blockId)
          })}
          header={blocks.length === 1 ? blockLabel(blocks[0]) : `${blocks.length} blocks`}
          search="Search actions…"
          onClose={close}
        />
      )}
      {panel?.kind === 'icon' && (
        <IconPickerPopover
          anchor={panel.anchor}
          onChange={(icon) => setPageIcon(panel.pageId, icon)}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === 'rename' && (
        <RenamePopover anchor={panel.anchor} pageId={panel.pageId} onClose={() => setPanel(null)} />
      )}
    </BlockMenuContext.Provider>
  )
}
