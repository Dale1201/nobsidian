import { nodeToBlock, type BlockNoteEditor } from '@blocknote/core'
import { CURSOR, SELECTION_END, SELECTION_START } from '@shared/ai'
import type { Block } from '@shared/core/blocks'
import { blocksToMarkdown } from '@shared/core/serialize'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>

const PLACEHOLDERS: Record<string, string> = {
  image: '[image]',
  video: '[video]',
  audio: '[audio]',
  file: '[file]',
  drawing: '[drawing]'
}

// Raw blocks are written out as they are, so the brackets are not escaped.
const marker = (markdown: string): Block => ({ type: 'raw', props: { markdown }, children: [] })

/** Media is named, never sent: its files stay on this Mac. */
function withoutMedia(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    const name = PLACEHOLDERS[block.type]
    if (name) return { ...marker(name), id: block.id } as Block
    return { ...block, children: withoutMedia(block.children) } as Block
  })
}

function wrapBlocks(blocks: Block[], ids: Set<string>): Block[] {
  const first = blocks.findIndex((b) => ids.has(b.id!))
  if (first === -1)
    return blocks.map((b) => ({ ...b, children: wrapBlocks(b.children, ids) }) as Block)
  let last = first
  while (last + 1 < blocks.length && ids.has(blocks[last + 1].id!)) last++
  return [
    ...blocks.slice(0, first),
    marker(SELECTION_START),
    ...blocks.slice(first, last + 1),
    marker(SELECTION_END),
    ...blocks.slice(last + 1)
  ]
}

/**
 * The page as Markdown, with the text selection, the selected blocks or the cursor marked,
 * for Claude to read.
 */
export function pageMarkdown(
  editor: AnyEditor,
  mark: { selectedBlocks: string[] } | { cursor: true } | { selection: true }
): string {
  const state = editor.prosemirrorState
  const tr = state.tr
  if ('selection' in mark) {
    tr.insertText(SELECTION_END, state.selection.to)
    tr.insertText(SELECTION_START, state.selection.from)
  } else if ('cursor' in mark) {
    tr.insertText(CURSOR, state.selection.from)
  }
  const blocks: Block[] = []
  tr.doc.firstChild!.forEach((node) => {
    blocks.push(nodeToBlock(node, tr.doc) as unknown as Block)
  })
  const marked =
    'selectedBlocks' in mark ? wrapBlocks(blocks, new Set(mark.selectedBlocks)) : blocks
  return blocksToMarkdown(withoutMedia(marked))
}
