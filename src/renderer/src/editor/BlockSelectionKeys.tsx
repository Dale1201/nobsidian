import { SuggestionMenu } from '@blocknote/core/extensions'
import { useEditorDOMElement, useExtension } from '@blocknote/react'
import { useEffect } from 'react'
import { blocksOf, deleteBlocks, moveBlocks } from './blockActions'
import { selectBlocks, selectedBlockIds } from './blockSelection'
import { stepSelection } from './blockSelectionModel'
import { targetBlockIds } from './notionKeys'
import type { AppEditor } from './schema'
import { useAppEditor } from './useAppEditor'

function onSelectionKey(editor: AppEditor, ids: string[], e: KeyboardEvent): boolean {
  const mod = e.metaKey || e.ctrlKey
  const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
  if (e.key === 'Escape') {
    selectBlocks(editor, [])
    return true
  }
  if (e.key === 'Enter' && !mod) {
    selectBlocks(editor, [])
    try {
      editor.setTextCursorPosition(ids[ids.length - 1], 'end')
    } catch {
      // A block without text has nowhere to put the cursor; it stays unselected.
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
    selectBlocks(editor, stepSelection(editor.document, ids, step, e.shiftKey))
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
        handled = onSelectionKey(editor, ids, e)
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
      const blocks = blocksOf(editor, ids)
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
