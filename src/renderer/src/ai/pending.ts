import { blockToNode, createExtension, type BlockNoteEditor } from '@blocknote/core'
import { Fragment, type Node, type ResolvedPos } from 'prosemirror-model'
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { markdownToBlocks } from '@shared/core/parse'
import type { Block } from '@shared/core/blocks'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>

export type Placement = 'edit' | 'insertBelow' | 'insertAtCursor' | 'editPage'

interface Range {
  from: number
  to: number
}

/**
 * A change the Writer has shown but not applied. The page itself is untouched apart from the
 * added content, which sits after anything it replaces, so these positions never move.
 */
export interface Pending {
  /** Text inside one block that a single paragraph replaces in place. */
  inline: Range | null
  /** Blocks replaced when the result is not inline; null when the result is only inserted. */
  blocks: Range | null
  /** Where block results go: after `blocks`, or after the cursor's block. */
  insertAt: number
  /** Whether anything has been shown, whether it is inline, and its size in the document. */
  rendered: boolean
  isInline: boolean
  addedSize: number
}

const key = new PluginKey<Pending | null>('nbAiPending')

export function pendingOf(state: EditorState): Pending | null {
  return key.getState(state) ?? null
}

export function hasPending(editor: AnyEditor): boolean {
  return pendingOf(editor.prosemirrorState) !== null
}

function containerDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'blockContainer') return d
  return -1
}

/** The run of sibling blocks that holds both ends of the selection. */
function touchedBlocks($from: ResolvedPos, $to: ResolvedPos): Range {
  const range = $from.blockRange($to, (node) => node.type.name === 'blockGroup')
  if (range) return { from: range.start, to: range.end }
  const d = containerDepth($from)
  return { from: $from.before(d), to: $from.after(d) }
}

function blockRange(doc: Node, ids: string[]): Range | null {
  let from = -1
  let to = -1
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer') return true
    if (ids.includes(node.attrs.id)) {
      if (from === -1) from = pos
      to = pos + node.nodeSize
      return false
    }
    return true
  })
  return from === -1 ? null : { from, to }
}

/** Where a result for `placement` goes, given the selection or the selected blocks. */
export function placementRanges(
  doc: Node,
  selection: Range,
  placement: Placement,
  selectedBlocks: string[] = []
): Omit<Pending, 'rendered' | 'isInline' | 'addedSize'> {
  if (placement === 'editPage') {
    const end = 1 + doc.firstChild!.content.size
    return { inline: null, blocks: { from: 1, to: end }, insertAt: end }
  }
  const $from = doc.resolve(selection.from)
  const $to = doc.resolve(selection.to)
  const empty = selection.from === selection.to
  const picked = selectedBlocks.length ? blockRange(doc, selectedBlocks) : null
  const touched = picked ?? touchedBlocks($from, $to)
  if (placement === 'insertBelow') return { inline: null, blocks: null, insertAt: touched.to }
  if (placement === 'insertAtCursor') {
    const d = containerDepth($from)
    const container = $from.node(d)
    const cursorBlock = { from: $from.before(d), to: $from.after(d) }
    const content = container.firstChild!
    const blank =
      container.childCount === 1 && content.type.name === 'paragraph' && content.content.size === 0
    return { inline: null, blocks: blank ? cursorBlock : null, insertAt: cursorBlock.to }
  }
  const inline =
    !picked && !empty && $from.parent === $to.parent && $from.parent.isTextblock
      ? { from: $from.pos, to: $to.pos }
      : null
  return { inline, blocks: touched, insertAt: touched.to }
}

/**
 * Starts a pending change on the highlighted text, or else the selection; nothing is shown
 * until the first render.
 */
export function beginPending(
  editor: AnyEditor,
  placement: Placement,
  selectedBlocks: string[] = []
): void {
  const state = editor.prosemirrorState
  const selection = uiKey.getState(state)?.highlight ?? state.selection
  const pending: Pending = {
    ...placementRanges(
      state.doc,
      { from: selection.from, to: selection.to },
      placement,
      selectedBlocks
    ),
    rendered: false,
    isInline: false,
    addedSize: 0
  }
  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)
    tr.setMeta(key, pending)
  })
}

function inlineFragment(editor: AnyEditor, blocks: Block[]): Fragment {
  const content = blocks[0]?.type === 'paragraph' ? blocks[0].content : []
  const paragraph = blockToNode({ type: 'paragraph', content } as never, editor.pmSchema)
  return paragraph.firstChild!.content
}

function blockFragment(editor: AnyEditor, blocks: Block[]): Fragment {
  return Fragment.from(blocks.map((block) => blockToNode(block as never, editor.pmSchema)))
}

const MEDIA = new Set(['image', 'video', 'audio', 'file', 'drawing'])
const WRAPPING_FENCE = /^```(?:markdown|md)?\n([\s\S]*?)\n?```\s*$/

/**
 * Claude's Markdown as blocks for the page. A fence around the whole answer is taken off, and
 * media is left out, so an answer can never make the page load a remote file.
 */
export function resultBlocks(markdown: string): Block[] {
  const fenced = WRAPPING_FENCE.exec(markdown.trim())
  const strip = (blocks: Block[]): Block[] =>
    blocks
      .filter((b) => !MEDIA.has(b.type))
      .map((b) => ({ ...b, children: strip(b.children) }) as Block)
  return strip(markdownToBlocks(fenced ? fenced[1] : markdown))
}

function fitsInline(blocks: Block[]): boolean {
  if (blocks.length === 0) return true
  return blocks.length === 1 && blocks[0].type === 'paragraph' && blocks[0].children.length === 0
}

/** Shows `markdown` as the pending result, in place of the previous one. */
export function renderPending(editor: AnyEditor, markdown: string): void {
  const pending = pendingOf(editor.prosemirrorState)
  if (!pending) return
  const blocks = resultBlocks(markdown)
  const isInline = pending.inline !== null && fitsInline(blocks)
  const fragment = isInline ? inlineFragment(editor, blocks) : blockFragment(editor, blocks)
  const at = isInline ? pending.inline!.to : pending.insertAt
  const { added } = pendingRanges(pending)
  // Small steps rather than a whole-document swap, so the undo history before the Writer survives.
  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)
    tr.delete(added.from, added.to)
    if (fragment.size) tr.insert(at, fragment)
    tr.setMeta(key, { ...pending, rendered: true, isInline, addedSize: fragment.size })
  })
}

/** The ranges the current render shows as removed and as added. */
export function pendingRanges(pending: Pending): { removed: Range | null; added: Range } {
  const removed = pending.isInline ? pending.inline : pending.blocks
  const at = pending.isInline ? pending.inline!.to : pending.insertAt
  return { removed, added: { from: at, to: at + pending.addedSize } }
}

// Cleared in a step of its own, after the content: the editor saves on content changes made
// while nothing is pending, and the page is by then exactly as it was saved.
function restore(editor: AnyEditor, pending: Pending): void {
  const { added } = pendingRanges(pending)
  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)
    tr.delete(added.from, added.to)
    tr.setMeta(key, { ...pending, addedSize: 0 })
  })
  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)
    tr.setMeta(key, null)
  })
}

/** Puts the page back as it was; the Writer leaves no trace, not even in undo history. */
export function undoPending(editor: AnyEditor): void {
  const pending = pendingOf(editor.prosemirrorState)
  if (pending) restore(editor, pending)
}

/** Applies the result as a single undoable change. */
export function acceptPending(editor: AnyEditor): void {
  const pending = pendingOf(editor.prosemirrorState)
  if (!pending) return
  if (!pending.rendered) return undoPending(editor)
  const { removed, added } = pendingRanges(pending)
  const content = editor.prosemirrorState.doc.slice(added.from, added.to).content
  restore(editor, pending)
  editor.transact((tr) => {
    // A replaced page body must keep at least one block.
    const fill =
      content.size === 0 && removed && !pending.isInline && removed.from === 1
        ? Fragment.from(blockToNode({ type: 'paragraph' }, editor.pmSchema))
        : content
    if (removed) tr.replaceWith(removed.from, removed.to, fill)
    else if (fill.size) tr.insert(pending.insertAt, fill)
  })
}

function decorations(state: EditorState): DecorationSet | null {
  const pending = pendingOf(state)
  if (!pending?.rendered) return null
  const { removed, added } = pendingRanges(pending)
  const out: Decoration[] = []
  const mark = (range: Range, kind: 'removed' | 'added'): void => {
    if (range.from === range.to) return
    if (pending.isInline) {
      out.push(Decoration.inline(range.from, range.to, { class: `nb-ai-${kind}` }))
      return
    }
    state.doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (node.type.name !== 'blockContainer') return true
      if (pos >= range.from && pos + node.nodeSize <= range.to) {
        out.push(Decoration.node(pos, pos + node.nodeSize, { class: `nb-ai-${kind}-block` }))
      }
      return false
    })
  }
  if (removed) mark(removed, 'removed')
  mark(added, 'added')
  return DecorationSet.create(state.doc, out)
}

interface WriterUi {
  /** The selection the Writer works on, kept visible while focus is in the Writer. */
  highlight: Range | null
  /** Whether AI can be used, which changes the empty-line hint. */
  available: boolean
}

const uiKey = new PluginKey<WriterUi>('nbAiWriterUi')

function setUi(editor: AnyEditor, patch: Partial<WriterUi>): void {
  const current = uiKey.getState(editor.prosemirrorState)
  if (!current) return
  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)
    tr.setMeta(uiKey, { ...current, ...patch })
  })
}

export function setHighlight(editor: AnyEditor, range: Range | null): void {
  setUi(editor, { highlight: range })
}

export function setAiAvailable(editor: AnyEditor, available: boolean): void {
  if (uiKey.getState(editor.prosemirrorState)?.available !== available) setUi(editor, { available })
}

export const aiPending = createExtension({
  key: 'nbAiPending',
  prosemirrorPlugins: [
    new Plugin<Pending | null>({
      key,
      state: {
        init: () => null,
        apply: (tr, value) => {
          const next = tr.getMeta(key) as Pending | null | undefined
          return next === undefined ? value : next
        }
      },
      props: {
        decorations,
        // The page waits while a change is pending; clicking it accepts or ends the change.
        editable: (state) => pendingOf(state) === null
      }
    }),
    new Plugin<WriterUi>({
      key: uiKey,
      state: {
        init: () => ({ highlight: null, available: false }),
        apply: (tr, value) => {
          const next = (tr.getMeta(uiKey) as WriterUi | undefined) ?? value
          if (!next.highlight || !tr.docChanged) return next
          const from = tr.mapping.map(next.highlight.from, 1)
          const to = tr.mapping.map(next.highlight.to, -1)
          return { ...next, highlight: from < to ? { from, to } : null }
        }
      },
      props: {
        decorations: (state) => {
          const highlight = uiKey.getState(state)?.highlight
          if (!highlight || pendingOf(state)?.rendered) return null
          return DecorationSet.create(state.doc, [
            Decoration.inline(highlight.from, highlight.to, { class: 'nb-ai-selected' })
          ])
        },
        attributes: (state): Record<string, string> =>
          uiKey.getState(state)?.available ? { class: 'nb-ai-available' } : {}
      }
    })
  ]
})
