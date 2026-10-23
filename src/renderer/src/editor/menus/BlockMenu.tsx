import { SideMenuExtension } from '@blocknote/core/extensions'
import { useEditorDOMElement, useExtension } from '@blocknote/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Menu } from '../../components/menu/Menu'
import { blocksOf } from '../blockActions'
import { selectBlocks } from '../blockSelection'
import { targetBlockIds } from '../notionKeys'
import { useAppEditor } from '../useAppEditor'
import { BlockMenuContext, type BlockMenuApi } from './blockMenuContext'
import { blockLabel, blockMenuEntries } from './entries'

export function BlockMenuHost({ children }: { children: ReactNode }): React.JSX.Element {
  const editor = useAppEditor()
  const sideMenu = useExtension(SideMenuExtension)
  const [state, setState] = useState<{ ids: string[]; anchor: DOMRect } | null>(null)

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

  const blocks = state ? blocksOf(editor, state.ids) : []
  return (
    <BlockMenuContext.Provider value={api}>
      {children}
      {state && blocks.length > 0 && (
        <Menu
          anchor={state.anchor}
          entries={blockMenuEntries(editor, blocks)}
          header={blocks.length === 1 ? blockLabel(blocks[0]) : `${blocks.length} blocks`}
          search="Search actions…"
          onClose={close}
        />
      )}
    </BlockMenuContext.Provider>
  )
}
