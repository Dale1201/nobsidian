import { flushSync } from 'react-dom'
import { useApp } from '../store'
import { selectBlocks } from '../editor/blockSelection'
import type { AppBlock, AppEditor } from '../editor/schema'

export interface DrawingSession {
  /** The drawing's file, or '' for one never saved. */
  url: string
  /** Points the block at a newly saved file; false when the block is gone. */
  apply(url: string): boolean
  /** Closes the editor; a drawing that was never saved loses its block. */
  close(): void
}

// Each tab's editable page editor, by tab: a page changed on disk is rebuilt while a drawing is
// open, and the drawing must land in the page of the tab it was opened in.
const pageEditors = new Map<string, { editor: AppEditor; pageId: string }>()

export function registerDrawingEditor(
  editor: AppEditor,
  slot: { tabId: string; pageId: string }
): () => void {
  pageEditors.set(slot.tabId, { editor, pageId: slot.pageId })
  return () => {
    if (pageEditors.get(slot.tabId)?.editor === editor) pageEditors.delete(slot.tabId)
  }
}

function drawingsWithUrl(blocks: AppBlock[], url: string, out: AppBlock[] = []): AppBlock[] {
  for (const block of blocks) {
    if (block.type === 'drawing' && block.props.url === url) out.push(block)
    drawingsWithUrl(block.children, url, out)
  }
  return out
}

function hasBlock(block: AppBlock, id: string): boolean {
  return block.children.some((child) => child.id === id || hasBlock(child, id))
}

export function openDrawing(editor: AppEditor, blockId: string): void {
  const block = editor.getBlock(blockId)
  if (block?.type !== 'drawing') return
  let url = block.props.url
  // A rebuilt editor gives every block a new id, so the drawing is found again by its file,
  // and a new drawing, which the page file does not have yet, goes back where it was.
  const nth = drawingsWithUrl(editor.document, url).findIndex((b) => b.id === blockId)
  const index = editor.document.findIndex((b) => b.id === blockId || hasBlock(b, blockId))
  const slot = [...pageEditors].find(([, e]) => e.editor === editor)
  /** This tab's editor for the page, after any rebuild. */
  const pageEditor = (): AppEditor | null => {
    const entry = slot && pageEditors.get(slot[0])
    return entry && entry.pageId === slot[1].pageId ? entry.editor : null
  }
  const locate = (): { editor: AppEditor; id: string } | null => {
    const current = pageEditor()
    if (!current) return null
    if (current === editor) {
      return current.getBlock(blockId)?.type === 'drawing' ? { editor, id: blockId } : null
    }
    const same = url ? drawingsWithUrl(current.document, url) : []
    const found = same[nth] ?? same[0]
    return found ? { editor: current, id: found.id } : null
  }
  const session: DrawingSession = {
    url,
    apply: (next) => {
      const target = locate()
      const current = pageEditor()
      if (!target && !url && current && current !== editor) {
        const blocks = current.document
        const block = { type: 'drawing' as const, props: { url: next } }
        if (index >= 0 && index < blocks.length)
          current.insertBlocks([block], blocks[index], 'before')
        else current.insertBlocks([block], blocks[blocks.length - 1], 'after')
        url = next
        return true
      }
      if (!target) return false
      target.editor.updateBlock(target.id, { props: { url: next } })
      url = next
      return true
    },
    close: () => {
      // The page is inert under the overlay, so it has to be gone before the page takes focus.
      flushSync(() => useApp.getState().setOverlay(null))
      const target = locate()
      if (!target) return
      target.editor.focus()
      // Selected, like Notion, so Enter opens it again and arrows move on from it.
      if (url) selectBlocks(target.editor, [target.id])
      else target.editor.removeBlocks([target.id])
    }
  }
  useApp.getState().setOverlay({ kind: 'drawing', session })
}
