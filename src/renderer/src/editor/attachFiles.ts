import type { Block } from '@shared/core/blocks'
import type { AppEditor, AppPartialBlock } from './schema'

/** Window event asking the open editor to attach dropped files at the cursor. */
export const ATTACH_FILES_EVENT = 'nobsidian:attach-files'

/** Puts blocks after the cursor's block, or in its place when that block is an empty paragraph. */
export function insertAtCursor(editor: AppEditor, blocks: Block[]): void {
  if (blocks.length === 0) return
  const partial = blocks as unknown as AppPartialBlock[]
  const cursor = editor.getTextCursorPosition().block
  const empty =
    cursor.type === 'paragraph' &&
    Array.isArray(cursor.content) &&
    cursor.content.length === 0 &&
    cursor.children.length === 0
  if (empty) editor.replaceBlocks([cursor], partial)
  else editor.insertBlocks(partial, cursor, 'after')
}

/** Pastes `text` as one paragraph per non-empty line. */
export function insertPlainText(editor: AppEditor, text: string): void {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  insertAtCursor(
    editor,
    lines.map((line) => ({
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text: line, styles: {} }],
      children: []
    }))
  )
}
