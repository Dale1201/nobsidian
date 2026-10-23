import { SuggestionMenu } from '@blocknote/core/extensions'
import { useEditorDOMElement, useExtension } from '@blocknote/react'
import { useEffect } from 'react'
import { blocksOf, deleteBlocks, moveBlocks } from './blockActions'
import { selectBlocks, selectedBlockIds } from './blockSelection'
import { stepSelection, topLevelIds } from './blockSelectionModel'
import { targetBlockIds } from './notionKeys'
import type { AppEditor } from './schema'
import { useAppEditor } from './useAppEditor'

// Blocks inside closed toggles have no box, and column containers are not drawn as blocks.
function onScreen(dom: HTMLElement, id: string): boolean {
  const el = dom.querySelector(`.bn-block-outer[data-id="${id}"]`)
  return el !== null && el.getClientRects().length > 0
}

function clipboardHTML(editor: AppEditor, ids: string[]): string {
  const view = editor.prosemirrorView
  const wanted = new Set(ids)
  let from = Infinity
  let to = -Infinity
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer' || !wanted.has(node.attrs.id)) return true
    from = Math.min(from, pos)
    to = Math.max(to, pos + node.nodeSize)
    return false
  })
  if (from > to) return ''
  return view.serializeForClipboard(view.state.doc.slice(from, to)).dom.innerHTML
}

function onSelectionKey(
  editor: AppEditor,
  dom: HTMLElement,
  ids: string[],
  e: KeyboardEvent
): boolean {
  const mod = e.metaKey || e.ctrlKey
  const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
  if (e.key === 'Escape') {
    selectBlocks(editor, [])
    return true
  }
  if (e.key === 'Enter' && !mod) {
    const last = editor.getBlock(ids[ids.length - 1])
    // A block without text, such as a page link, would be left invisibly node-selected,
    // and the next paste would replace it; it stays selected instead.
    if (last?.content !== undefined) {
      selectBlocks(editor, [])
      editor.setTextCursorPosition(last, 'end')
    }
    return true
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    deleteBlocks(editor, ids)
    return true
  }
  if (vertical && mod && e.shiftKey) {
    moveBlocks(editor, ids, e.key === 'ArrowUp' ? 'up' : 'down')
    selectBlocks(editor, ids)
    return true
  }
  if (vertical && !mod) {
    const step = e.key === 'ArrowUp' ? -1 : 1
    const next = stepSelection(editor.document, ids, step, e.shiftKey, (id) => onScreen(dom, id))
    selectBlocks(editor, next)
    return true
  }
  // Shortcuts like Cmd+D, Cmd+/ and Cmd+C have their own handlers; typing is ignored, as in Notion.
  return !mod && e.key.length === 1
}

export function BlockSelectionKeys(): null {
  const editor = useAppEditor()
  const dom = useEditorDOMElement()
  const suggestionMenu = useExtension(SuggestionMenu)

  useEffect(() => {
    if (!dom) return
    const onKey = (e: KeyboardEvent): void => {
      const ids = selectedBlockIds(editor)
      let handled = false
      if (ids.length) {
        handled = onSelectionKey(editor, dom, ids, e)
      } else if (e.key === 'Escape' && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (!suggestionMenu.shown()) {
          selectBlocks(editor, targetBlockIds(editor))
          handled = true
        }
      }
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onClipboard = (e: ClipboardEvent): void => {
      const ids = selectedBlockIds(editor)
      if (!ids.length || !e.clipboardData) return
      const roots = topLevelIds(editor.document, ids)
      const blocks = blocksOf(editor, roots)
      // BlockNote's own format, so a paste back into the app keeps mentions and custom blocks.
      e.clipboardData.setData('blocknote/html', clipboardHTML(editor, roots))
      e.clipboardData.setData('text/html', editor.blocksToHTMLLossy(blocks))
      e.clipboardData.setData('text/plain', editor.blocksToMarkdownLossy(blocks))
      e.preventDefault()
      if (e.type === 'cut') deleteBlocks(editor, ids)
    }
    // Capture phase, so these run before ProseMirror's own handlers.
    dom.addEventListener('keydown', onKey, true)
    dom.addEventListener('copy', onClipboard, true)
    dom.addEventListener('cut', onClipboard, true)
    return () => {
      dom.removeEventListener('keydown', onKey, true)
      dom.removeEventListener('copy', onClipboard, true)
      dom.removeEventListener('cut', onClipboard, true)
    }
  }, [dom, editor, suggestionMenu])
  return null
}
