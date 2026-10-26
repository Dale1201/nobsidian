// @vitest-environment happy-dom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core'
import { TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import {
  acceptPending,
  aiPending,
  beginPending,
  hasPending,
  pendingOf,
  pendingRanges,
  renderPending,
  resultBlocks,
  undoPending
} from './pending'

type Editor = BlockNoteEditor

function editorWith(blocks: PartialBlock[]): Editor {
  const editor = BlockNoteEditor.create({ initialContent: blocks, extensions: [aiPending] })
  // Extensions' plugins only exist once the editor is mounted.
  editor.mount(document.createElement('div'))
  return editor
}

/** Selects `text` inside the document, by its first occurrence. */
function select(editor: Editor, text: string, end?: string): void {
  let from = -1
  let to = -1
  editor.prosemirrorState.doc.descendants((node, pos) => {
    if (!node.isText) return true
    const i = node.text!.indexOf(text)
    if (from === -1 && i !== -1) from = pos + i
    const j = node.text!.indexOf(end ?? text)
    if (j !== -1) to = pos + j + (end ?? text).length
    return true
  })
  editor.transact((tr) => tr.setSelection(TextSelection.create(tr.doc, from, to)))
}

function cursorIn(editor: Editor, id: string): void {
  editor.setTextCursorPosition(id, 'end')
}

const texts = (editor: Editor): string[] =>
  editor.document.map((b) => (b.content as { text?: string }[]).map((c) => c.text ?? '').join(''))

const page = (): PartialBlock[] => [
  { id: 'a', type: 'paragraph', content: 'Intro.' },
  { id: 'b', type: 'paragraph', content: 'We spent the hour arguing about launch.' },
  { id: 'c', type: 'paragraph', content: 'Outro.' }
]

describe('a rewrite of words inside one block', () => {
  it('shows the old words and the new ones side by side, inline', () => {
    const editor = editorWith(page())
    select(editor, 'spent the hour arguing')
    beginPending(editor, 'edit')
    renderPending(editor, 'argued')
    expect(texts(editor)).toEqual([
      'Intro.',
      'We spent the hour arguingargued about launch.',
      'Outro.'
    ])
    const pending = pendingOf(editor.prosemirrorState)!
    expect(pending.isInline).toBe(true)
    const { removed, added } = pendingRanges(pending)
    const doc = editor.prosemirrorState.doc
    expect(doc.textBetween(removed!.from, removed!.to)).toBe('spent the hour arguing')
    expect(doc.textBetween(added.from, added.to)).toBe('argued')
  })

  it('accepts as one undo step that restores the original exactly', () => {
    const editor = editorWith(page())
    select(editor, 'spent the hour arguing')
    beginPending(editor, 'edit')
    renderPending(editor, 'arg')
    renderPending(editor, 'argued')
    acceptPending(editor)
    expect(hasPending(editor)).toBe(false)
    expect(texts(editor)).toEqual(['Intro.', 'We argued about launch.', 'Outro.'])
    editor.undo()
    expect(texts(editor)).toEqual(['Intro.', 'We spent the hour arguing about launch.', 'Outro.'])
    editor.redo()
    expect(texts(editor)).toEqual(['Intro.', 'We argued about launch.', 'Outro.'])
  })

  it('switches to whole blocks when the result grows a second paragraph', () => {
    const editor = editorWith(page())
    select(editor, 'spent the hour arguing')
    beginPending(editor, 'edit')
    renderPending(editor, 'One.')
    renderPending(editor, 'One.\n\nTwo.')
    expect(pendingOf(editor.prosemirrorState)!.isInline).toBe(false)
    expect(texts(editor)).toEqual([
      'Intro.',
      'We spent the hour arguing about launch.',
      'One.',
      'Two.',
      'Outro.'
    ])
    acceptPending(editor)
    expect(texts(editor)).toEqual(['Intro.', 'One.', 'Two.', 'Outro.'])
  })
})

describe('blocks', () => {
  it('replace every block a selection touches', () => {
    const editor = editorWith(page())
    select(editor, 'Intro', 'arguing')
    beginPending(editor, 'edit')
    renderPending(editor, '- First\n- Second')
    acceptPending(editor)
    expect(editor.document.map((b) => b.type)).toEqual([
      'bulletListItem',
      'bulletListItem',
      'paragraph'
    ])
    expect(texts(editor)).toEqual(['First', 'Second', 'Outro.'])
  })

  it('replace blocks picked with block selection', () => {
    const editor = editorWith(page())
    cursorIn(editor, 'a')
    beginPending(editor, 'edit', ['b', 'c'])
    renderPending(editor, 'Merged.')
    expect(pendingOf(editor.prosemirrorState)!.isInline).toBe(false)
    acceptPending(editor)
    expect(texts(editor)).toEqual(['Intro.', 'Merged.'])
  })

  it('insert below the selection, keeping it', () => {
    const editor = editorWith(page())
    select(editor, 'arguing')
    beginPending(editor, 'insertBelow')
    renderPending(editor, 'Summary.')
    expect(pendingRanges(pendingOf(editor.prosemirrorState)!).removed).toBeNull()
    acceptPending(editor)
    expect(texts(editor)).toEqual([
      'Intro.',
      'We spent the hour arguing about launch.',
      'Summary.',
      'Outro.'
    ])
  })

  it('insert after the cursor block, or in place of an empty one', () => {
    const editor = editorWith([...page(), { id: 'd', type: 'paragraph' }])
    cursorIn(editor, 'a')
    beginPending(editor, 'insertAtCursor')
    renderPending(editor, 'More.')
    acceptPending(editor)
    expect(texts(editor)).toEqual([
      'Intro.',
      'More.',
      'We spent the hour arguing about launch.',
      'Outro.',
      ''
    ])

    cursorIn(editor, 'd')
    beginPending(editor, 'insertAtCursor')
    renderPending(editor, 'End.')
    acceptPending(editor)
    expect(texts(editor)).toEqual([
      'Intro.',
      'More.',
      'We spent the hour arguing about launch.',
      'Outro.',
      'End.'
    ])
  })

  it('replace the whole page body, which keeps at least one block', () => {
    const editor = editorWith(page())
    cursorIn(editor, 'b')
    beginPending(editor, 'editPage')
    renderPending(editor, 'Hallo.\n\nWelt.')
    acceptPending(editor)
    expect(texts(editor)).toEqual(['Hallo.', 'Welt.'])
    editor.undo()
    expect(texts(editor)).toEqual(['Intro.', 'We spent the hour arguing about launch.', 'Outro.'])

    beginPending(editor, 'editPage')
    renderPending(editor, '')
    acceptPending(editor)
    expect(editor.document).toHaveLength(1)
    expect(texts(editor)).toEqual([''])
  })
})

describe('undo', () => {
  it('puts the page back with nothing left in history', () => {
    const editor = editorWith(page())
    editor.updateBlock('a', { content: 'Intro.!' })
    select(editor, 'Outro')
    beginPending(editor, 'edit')
    renderPending(editor, 'Bye')
    undoPending(editor)
    expect(hasPending(editor)).toBe(false)
    expect(texts(editor)).toEqual(['Intro.!', 'We spent the hour arguing about launch.', 'Outro.'])
    editor.undo()
    expect(texts(editor)).toEqual(['Intro.', 'We spent the hour arguing about launch.', 'Outro.'])
  })

  it('happens instead of accepting when nothing came back', () => {
    const editor = editorWith(page())
    select(editor, 'Outro')
    beginPending(editor, 'edit')
    acceptPending(editor)
    expect(hasPending(editor)).toBe(false)
    expect(texts(editor)).toEqual(['Intro.', 'We spent the hour arguing about launch.', 'Outro.'])
    expect(editor.undo()).toBe(false)
  })
})

describe('decorations', () => {
  it('mark removed and added content while pending, and nothing after', () => {
    const editor = editorWith(page())
    select(editor, 'Intro', 'arguing')
    beginPending(editor, 'edit')
    renderPending(editor, 'New.')
    const dom = editor.domElement!
    const marked = (cls: string): string[] =>
      [...dom.querySelectorAll(`.${cls}`)].map((el) => el.textContent ?? '')
    expect(marked('nb-ai-removed-block')).toEqual([
      'Intro.',
      'We spent the hour arguing about launch.'
    ])
    expect(marked('nb-ai-added-block')).toEqual(['New.'])
    undoPending(editor)
    expect(dom.querySelectorAll('[class*="nb-ai-"]')).toHaveLength(0)
  })

  it('mark inline words while pending', () => {
    const editor = editorWith(page())
    select(editor, 'the hour')
    beginPending(editor, 'edit')
    renderPending(editor, 'an hour')
    const dom = editor.domElement!
    expect(dom.querySelector('.nb-ai-removed')?.textContent).toBe('the hour')
    expect(dom.querySelector('.nb-ai-added')?.textContent).toBe('an hour')
  })
})

describe("Claude's answers", () => {
  it('lose a code fence wrapped around the whole answer', () => {
    expect(resultBlocks('```markdown\n- One\n- Two\n```').map((b) => b.type)).toEqual([
      'bulletListItem',
      'bulletListItem'
    ])
    expect(resultBlocks('```md\nPlain.\n```\n').map((b) => b.type)).toEqual(['paragraph'])
    expect(resultBlocks('```ts\nconst a = 1\n```').map((b) => b.type)).toEqual(['codeBlock'])
  })

  it('never bring images or files into the page', () => {
    const blocks = resultBlocks('Look:\n\n![chart](https://example.com/pixel.png)\n\nDone.')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
    expect(JSON.stringify(blocks)).not.toContain('example.com')
  })

  it('keep a heading or a to-do what it is after an inline edit', () => {
    const editor = editorWith([
      { id: 'h', type: 'heading', props: { level: 2 }, content: 'Launch plan' },
      { id: 't', type: 'checkListItem', props: { checked: true }, content: 'Book the room' }
    ])
    select(editor, 'Launch')
    beginPending(editor, 'edit')
    renderPending(editor, 'Release')
    acceptPending(editor)
    select(editor, 'Book')
    beginPending(editor, 'edit')
    renderPending(editor, 'Reserve')
    acceptPending(editor)
    expect(editor.document.map((b) => [b.type, b.props])).toEqual([
      ['heading', expect.objectContaining({ level: 2 })],
      ['checkListItem', expect.objectContaining({ checked: true })]
    ])
    expect(texts(editor)).toEqual(['Release plan', 'Reserve the room'])
  })
})
