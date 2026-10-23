import { createExtension } from '@blocknote/core'
import { duplicateBlocks, turnIntoBlocks } from './blockActions'
import { selectBlocks, selectedBlockIds } from './blockSelection'
import type { AppEditor } from './schema'
import type { TurnIntoId } from './turnInto'

/** The selected blocks, or the blocks the text selection touches. */
export function targetBlockIds(editor: AppEditor): string[] {
  const selected = selectedBlockIds(editor)
  if (selected.length) return selected
  const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
  return blocks.map((b) => b.id)
}

const TURN_KEYS: Record<string, TurnIntoId> = {
  'Mod-Alt-0': 'paragraph',
  'Mod-Alt-1': 'heading1',
  'Mod-Alt-2': 'heading2',
  'Mod-Alt-3': 'heading3',
  'Mod-Alt-4': 'todo',
  'Mod-Alt-5': 'bullet',
  'Mod-Alt-6': 'numbered',
  'Mod-Alt-7': 'toggle',
  'Mod-Alt-8': 'code'
}

/** Ticks to-dos and opens or closes toggles: the selected blocks, or the one with the caret. */
function toggleBlocks(editor: AppEditor): boolean {
  let handled = false
  for (const id of targetBlockIds(editor)) {
    const block = editor.getBlock(id)
    if (!block) continue
    if (block.type === 'checkListItem') {
      editor.updateBlock(block, { props: { checked: !block.props.checked } })
      handled = true
      continue
    }
    // Its own button, not one of a nested toggle child.
    const button = editor.domElement?.querySelector<HTMLElement>(
      `.bn-block-outer[data-id="${id}"] > .bn-block > .bn-toggle-frame > .bn-toggle-button`
    )
    if (button) {
      button.click()
      handled = true
    }
  }
  return handled
}

export const notionKeys = createExtension({
  key: 'nb-notion-keys',
  keyboardShortcuts: {
    ...Object.fromEntries(
      Object.entries(TURN_KEYS).map(([keys, id]) => [
        keys,
        ({ editor }) => {
          const app = editor as AppEditor
          turnIntoBlocks(app, targetBlockIds(app), id)
          return true
        }
      ])
    ),
    'Mod-d': ({ editor }) => {
      const app = editor as AppEditor
      const wasSelected = selectedBlockIds(app).length > 0
      const copies = duplicateBlocks(app, targetBlockIds(app))
      if (wasSelected) selectBlocks(app, copies)
      return true
    },
    'Mod-Enter': ({ editor }) => toggleBlocks(editor as AppEditor)
  }
})
