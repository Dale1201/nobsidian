import type { BlockNoteEditor } from '@blocknote/core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>

interface WriterControls {
  open: () => void
  close: () => void
}

const writers = new WeakMap<AnyEditor, WriterControls>()

/** Lets toolbar buttons, keys and slash items reach the Writer of the editor they belong to. */
export function registerWriter(editor: AnyEditor, controls: WriterControls): () => void {
  writers.set(editor, controls)
  return () => {
    if (writers.get(editor) === controls) writers.delete(editor)
  }
}

export function openWriter(editor: AnyEditor): void {
  writers.get(editor)?.open()
}

export function closeWriter(editor: AnyEditor): void {
  writers.get(editor)?.close()
}
