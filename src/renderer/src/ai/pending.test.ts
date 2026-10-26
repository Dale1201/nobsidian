// @vitest-environment happy-dom
import { BlockNoteEditor, BlockNoteSchema, type Block, type PartialBlock } from '@blocknote/core'
import { withMultiColumn } from '@blocknote/xl-multi-column'
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

type Tree = (string | [string, Tree])[]

const textOf = (block: Block): string =>
  (block.content as { text?: string }[]).map((c) => c.text ?? '').join('')

const tree = (blocks: Block[]): Tree =>
  blocks.map((b) => (b.children.length ? [textOf(b), tree(b.children)] : textOf(b)))

/** Where `text` starts in the document. */
function posOf(editor: Editor, text: string): number {
  let at = -1
  editor.prosemirrorState.doc.descendants((node, pos) => {
    const i = node.isText ? node.text!.indexOf(text) : -1
    if (at === -1 && i !== -1) at = pos + i
    return at === -1
  })
  return at
}

const marked = (editor: Editor, cls: string): string[] =>
  [...editor.domElement!.querySelectorAll(`.${cls}`)].map((el) => el.textContent ?? '')

const nested = (): PartialBlock[] => [
  {
    id: 'p',
    type: 'bulletListItem',
    content: 'Parent',
    children: [
      { id: 'c1', type: 'bulletListItem', content: 'Child one' },
      { id: 'c2', type: 'bulletListItem', content: 'Child two' }
    ]
  },
  { id: 'after', type: 'paragraph', content: 'After' }
]

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

  it('remove a first block that comes back empty, keeping the rest', () => {
    const editor = editorWith(page())
    beginPending(editor, 'edit', ['a'])
    renderPending(editor, '')
    acceptPending(editor)
    expect(texts(editor)).toEqual(['We spent the hour arguing about launch.', 'Outro.'])
  })
})

describe('nested blocks', () => {
  it('mark a change inside a child block', () => {
    const editor = editorWith(nested())
    select(editor, 'one')
    beginPending(editor, 'edit')
    renderPending(editor, 'X.\n\nY.')
    expect(marked(editor, 'nb-ai-removed-block')).toEqual(['Child one'])
    expect(marked(editor, 'nb-ai-added-block')).toEqual(['X.', 'Y.'])
  })

  it('mark blocks inserted below a child block', () => {
    const editor = editorWith(nested())
    select(editor, 'one')
    beginPending(editor, 'insertBelow')
    renderPending(editor, 'Summary.')
    expect(marked(editor, 'nb-ai-added-block')).toEqual(['Summary.'])
  })

  it('keep the children of a rewritten block when only its own text was selected', () => {
    const editor = editorWith(nested())
    const before = editor.document
    select(editor, 'Parent')
    beginPending(editor, 'edit')
    renderPending(editor, 'A.\n\nB.')
    expect(marked(editor, 'nb-ai-removed-block')).toEqual(['Parent'])
    const inline = [...editor.domElement!.querySelectorAll('.bn-inline-content')]
    for (const child of ['Child one', 'Child two']) {
      const el = inline.find((e) => e.textContent === child)!
      expect(el.closest('.nb-ai-removed-block, .nb-ai-removed')).toBeNull()
    }
    acceptPending(editor)
    expect(tree(editor.document)).toEqual(['A.', ['B.', ['Child one', 'Child two']], 'After'])
    editor.undo()
    expect(editor.document).toEqual(before)
  })

  it('keep children after a result that already has its own', () => {
    const editor = editorWith(nested())
    select(editor, 'Parent')
    beginPending(editor, 'edit')
    renderPending(editor, '- A.\n    - A1.')
    acceptPending(editor)
    expect(tree(editor.document)).toEqual([['A.', ['A1.', 'Child one', 'Child two']], 'After'])
  })

  it('replace the children too when the selection reaches into them, or picks the block', () => {
    const editor = editorWith(nested())
    const before = editor.document
    select(editor, 'Parent', 'one')
    beginPending(editor, 'edit')
    renderPending(editor, 'A.\n\nB.')
    acceptPending(editor)
    expect(tree(editor.document)).toEqual(['A.', 'B.', 'After'])
    editor.undo()
    expect(editor.document).toEqual(before)

    beginPending(editor, 'edit', ['p'])
    renderPending(editor, 'A.')
    acceptPending(editor)
    expect(tree(editor.document)).toEqual(['A.', 'After'])
  })
})

describe('edits made by others while pending', () => {
  it('move the change along with them', () => {
    const editor = editorWith(page())
    select(editor, 'Outro')
    beginPending(editor, 'edit')
    renderPending(editor, 'Bye')
    const intro = posOf(editor, 'Intro.')
    editor.transact((tr) => tr.insertText('Hello. ', intro))
    renderPending(editor, 'Goodbye')
    acceptPending(editor)
    expect(texts(editor)).toEqual([
      'Hello. Intro.',
      'We spent the hour arguing about launch.',
      'Goodbye.'
    ])
  })

  it('leave them in place on Undo', () => {
    const editor = editorWith(page())
    beginPending(editor, 'edit', ['b'])
    renderPending(editor, 'Brand new text')
    const intro = posOf(editor, 'Intro.')
    editor.transact((tr) => tr.insertText('Hi ', intro))
    undoPending(editor)
    expect(texts(editor)).toEqual([
      'Hi Intro.',
      'We spent the hour arguing about launch.',
      'Outro.'
    ])
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

  it('mark nothing until the first text arrives', () => {
    const editor = editorWith(page())
    beginPending(editor, 'edit', ['c'])
    const dom = editor.domElement!
    expect(dom.querySelectorAll('.nb-ai-removed-block, .nb-ai-removed')).toHaveLength(0)
    renderPending(editor, 'Bye.')
    expect(marked(editor, 'nb-ai-removed-block')).toEqual(['Outro.'])
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
    expect(resultBlocks('```\nconst a = 1\n```').map((b) => b.type)).toEqual(['codeBlock'])
  })

  it('never bring images or files into the page', () => {
    const blocks = resultBlocks('Look:\n\n![chart](https://example.com/pixel.png)\n\nDone.')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
    expect(JSON.stringify(blocks)).not.toContain('example.com')
  })

  it('go into a code block as they are, never as Markdown', () => {
    const editor = editorWith([{ id: 'k', type: 'codeBlock', content: 'return x' }])
    select(editor, 'x')
    beginPending(editor, 'edit')
    renderPending(editor, 'a*b*c + __init__')
    acceptPending(editor)
    expect(texts(editor)).toEqual(['return a*b*c + __init__'])

    select(editor, 'a*b*c')
    beginPending(editor, 'edit')
    renderPending(editor, '```python\na**2\n```')
    acceptPending(editor)
    expect(texts(editor)).toEqual(['return a**2 + __init__'])

    select(editor, 'a**2')
    beginPending(editor, 'edit')
    renderPending(editor, 'b\n')
    acceptPending(editor)
    expect(texts(editor)).toEqual(['return b + __init__'])
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

const NESTED =
  '<div data-columns>\n\n<div data-column>\n\nA\n\n</div>\n\n<div data-column>\n\nB\n\n</div>\n\n</div>'

describe('blocks in columns', () => {
  function columns(): Editor {
    const editor = BlockNoteEditor.create({
      schema: withMultiColumn(BlockNoteSchema.create()),
      initialContent: [
        {
          type: 'columnList',
          children: [
            { type: 'column', children: [{ type: 'paragraph', content: 'Left.' }] },
            { type: 'column', children: [{ type: 'paragraph', content: 'Right.' }] }
          ]
        }
      ] as never,
      extensions: [aiPending]
    }) as unknown as Editor
    editor.mount(document.createElement('div'))
    return editor
  }

  const shape = (editor: Editor): Tree =>
    tree((editor.document[0].children as Block[]).flatMap((column) => column.children))

  it('replace only the column the selection is in', () => {
    const editor = columns()
    select(editor, 'Left.')
    beginPending(editor, 'edit')
    renderPending(editor, 'Left, then.\n\nMore.')
    expect(marked(editor, 'nb-ai-removed-block')).toEqual(['Left.'])
    acceptPending(editor)
    expect(editor.document[0].children.map((c) => tree(c.children))).toEqual([
      ['Left, then.', 'More.'],
      ['Right.']
    ])
  })

  it('keep one block in a column that comes back empty', () => {
    const editor = columns()
    beginPending(editor, 'edit', [editor.document[0].children[0].children[0].id])
    renderPending(editor, '')
    acceptPending(editor)
    expect(shape(editor)).toEqual(['', 'Right.'])
  })

  it('stream as columns, never as raw Markdown, where the page can take them', () => {
    const editor = BlockNoteEditor.create({
      schema: withMultiColumn(BlockNoteSchema.create()),
      initialContent: page(),
      extensions: [aiPending]
    }) as unknown as Editor
    editor.mount(document.createElement('div'))
    select(editor, 'Outro.')
    beginPending(editor, 'edit')
    for (let n = 1; n <= NESTED.length; n++) {
      renderPending(editor, NESTED.slice(0, n), true)
      expect(editor.document.map((b) => b.type)).not.toContain('raw')
    }
    renderPending(editor, NESTED)
    acceptPending(editor)
    expect(editor.document.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'columnList'])
    expect(editor.document[2].children.map((c) => tree(c.children))).toEqual([['A'], ['B']])
  })

  it('show nothing of an answer until some of it is whole', () => {
    const editor = columns()
    select(editor, 'Left.')
    beginPending(editor, 'edit')
    expect(renderPending(editor, '<div data-col', true)).toBe(false)
    expect(pendingOf(editor.prosemirrorState)?.rendered).toBe(false)
  })

  it('are refused, changing nothing, where the page cannot take them', () => {
    const editor = columns()
    select(editor, 'Left.')
    beginPending(editor, 'edit')
    renderPending(editor, 'Left, then.\n\nMore.')
    const before = editor.prosemirrorState.doc
    expect(() => renderPending(editor, NESTED)).toThrow(RangeError)
    expect(() => renderPending(editor, NESTED.slice(0, 50), true)).toThrow(RangeError)
    expect(editor.prosemirrorState.doc.eq(before)).toBe(true)
    expect(marked(editor, 'nb-ai-added-block')).toEqual(['Left, then.', 'More.'])
  })
})
