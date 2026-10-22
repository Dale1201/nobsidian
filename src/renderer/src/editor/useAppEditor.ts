import { useBlockNoteEditor } from '@blocknote/react'
import type { AppEditor, AppSchema } from './schema'

export function useAppEditor(): AppEditor {
  return useBlockNoteEditor<
    AppSchema['blockSchema'],
    AppSchema['inlineContentSchema'],
    AppSchema['styleSchema']
  >() as AppEditor
}
