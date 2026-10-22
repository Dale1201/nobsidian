import type { AppBlock, AppEditor, AppPartialBlock } from './schema'
import { canTurnInto, turnIntoUpdate, type TurnIntoId } from './turnInto'

export function blocksOf(editor: AppEditor, ids: string[]): AppBlock[] {
  return ids.map((id) => editor.getBlock(id)).filter((b): b is AppBlock => b !== undefined)
}

export function turnIntoBlocks(editor: AppEditor, ids: string[], id: TurnIntoId): void {
  editor.transact(() => {
    for (const block of blocksOf(editor, ids)) {
      if (canTurnInto(block)) {
        editor.updateBlock(block, turnIntoUpdate(block, id) as unknown as AppPartialBlock)
      }
    }
  })
}

export function colorBlocks(
  editor: AppEditor,
  ids: string[],
  prop: 'textColor' | 'backgroundColor',
  color: string
): void {
  editor.transact(() => {
    for (const block of blocksOf(editor, ids)) {
      if (prop in block.props) {
        editor.updateBlock(block, { props: { [prop]: color } } as unknown as AppPartialBlock)
      }
    }
  })
}

function copyOf(block: AppBlock): AppPartialBlock {
  return {
    type: block.type,
    props: block.props,
    content: block.content,
    children: block.children.map(copyOf)
  } as unknown as AppPartialBlock
}

/** Inserts copies after the last block and returns their ids. */
export function duplicateBlocks(editor: AppEditor, ids: string[]): string[] {
  const blocks = blocksOf(editor, ids)
  if (blocks.length === 0) return []
  const last = blocks[blocks.length - 1]
  return editor.insertBlocks(blocks.map(copyOf), last, 'after').map((b) => b.id)
}

export function deleteBlocks(editor: AppEditor, ids: string[]): void {
  const blocks = blocksOf(editor, ids)
  if (blocks.length) editor.removeBlocks(blocks)
}
