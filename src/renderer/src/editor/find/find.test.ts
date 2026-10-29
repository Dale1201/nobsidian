// @vitest-environment happy-dom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core'
import { Schema } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { find, findState, replaceAll, replaceCurrent, setFindQuery, stepFind } from './findPlugin'
import { findMatches, fold, selectionQuery } from './matches'

const schema = new Schema({
  nodes: {
    doc: { content: 'para+' },
    para: { content: 'inline*' },
    text: { group: 'inline' },
    chip: { group: 'inline', inline: true, atom: true }
  }
})

const para = (...parts: (string | 'CHIP')[]): ReturnType<typeof schema.node> =>
  schema.node(
    'para',
    null,
    parts.map((p) => (p === 'CHIP' ? schema.node('chip') : schema.text(p)))
  )

const texts = (doc: ReturnType<typeof schema.node>, q: string): string[] =>
  findMatches(doc, q).map((m) => doc.textBetween(m.from, m.to, undefined, '￼'))

describe('findMatches', () => {
  it('finds every case-insensitive occurrence, in document order', () => {
    const doc = schema.node('doc', null, [para('Apple apple'), para('APPLE pie')])
    expect(texts(doc, 'apple')).toEqual(['Apple', 'apple', 'APPLE'])
  })

  it('never matches across blocks or object chips', () => {
    const doc = schema.node('doc', null, [para('end'), para('start'), para('ab', 'CHIP', 'cd')])
    expect(findMatches(doc, 'endstart')).toEqual([])
    expect(findMatches(doc, 'bc')).toEqual([])
    expect(texts(doc, 'cd')).toEqual(['cd'])
  })

  it('places matches after a chip correctly', () => {
    const doc = schema.node('doc', null, [para('x', 'CHIP', 'needle')])
    const [m] = findMatches(doc, 'needle')
    expect(doc.textBetween(m.from, m.to)).toBe('needle')
  })

  it('does not overlap matches and ignores an empty query', () => {
    const doc = schema.node('doc', null, [para('aaaa')])
    expect(findMatches(doc, 'aa')).toHaveLength(2)
    expect(findMatches(doc, '')).toEqual([])
  })

  it('keeps offsets when lowercasing would change a string length', () => {
    expect(fold('İx')).toHaveLength(2)
    const doc = schema.node('doc', null, [para('İstanbul and more')])
    expect(texts(doc, 'more')).toEqual(['more'])
  })
})

describe('selectionQuery', () => {
  const doc = schema.node('doc', null, [para('ab', 'CHIP', 'cd'), para('ef')])
  const selected = (from: number, to: number): string =>
    selectionQuery(EditorState.create({ doc, selection: TextSelection.create(doc, from, to) }))

  it('is the text selected within one block', () => {
    expect(selected(1, 3)).toBe('ab')
    expect(selected(4, 6)).toBe('cd')
  })

  it('is empty for a selection holding a chip, crossing blocks, or empty', () => {
    expect(selected(2, 5)).toBe('')
    expect(selected(5, 10)).toBe('')
    expect(selected(2, 2)).toBe('')
  })
})

function editorWith(blocks: PartialBlock[]): BlockNoteEditor {
  const editor = BlockNoteEditor.create({ initialContent: blocks, extensions: [find] })
  editor.mount(document.createElement('div'))
  return editor
}

const text = (editor: BlockNoteEditor): string[] =>
  editor.document.map((b) => (b.content as { text?: string }[]).map((c) => c.text ?? '').join(''))

describe('find plugin', () => {
  it('counts matches, steps with wrap-around and follows edits', () => {
    const editor = editorWith([
      { type: 'paragraph', content: 'cat dog cat' },
      { type: 'heading', content: 'Cat' }
    ])
    const view = editor.prosemirrorView
    setFindQuery(view, 'cat')
    expect(findState(view.state).matches).toHaveLength(3)
    expect(findState(view.state).current).toBe(0)
    stepFind(view, -1)
    expect(findState(view.state).current).toBe(2)
    stepFind(view, 1)
    expect(findState(view.state).current).toBe(0)
    editor.insertBlocks(
      [{ type: 'paragraph', content: 'one more cat' }],
      editor.document[1],
      'after'
    )
    expect(findState(view.state).matches).toHaveLength(4)
    setFindQuery(view, '')
    expect(findState(view.state).matches).toEqual([])
  })

  it('replaces the current match and moves on, without re-matching the replacement', () => {
    const editor = editorWith([{ type: 'paragraph', content: 'a b a b a' }])
    const view = editor.prosemirrorView
    setFindQuery(view, 'a')
    stepFind(view, 1)
    replaceCurrent(view, 'aa')
    expect(text(editor)).toEqual(['a b aa b a'])
    const { matches, current } = findState(view.state)
    expect(matches).toHaveLength(4)
    expect(current).toBe(3)
  })

  it('replaces all in one undo step and keeps formatting', () => {
    const editor = editorWith([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'red', styles: { bold: true } },
          { type: 'text', text: ' and red', styles: {} }
        ]
      }
    ])
    const view = editor.prosemirrorView
    setFindQuery(view, 'red')
    replaceAll(view, 'blue')
    expect(text(editor)).toEqual(['blue and blue'])
    expect(editor.document[0].content).toEqual([
      { type: 'text', text: 'blue', styles: { bold: true } },
      { type: 'text', text: ' and blue', styles: {} }
    ])
    expect(findState(view.state).matches).toEqual([])
    editor.undo()
    expect(text(editor)).toEqual(['red and red'])
  })

  it('makes each replace its own undo step, however quickly they follow', () => {
    const editor = editorWith([{ type: 'paragraph', content: 'x x x' }])
    const view = editor.prosemirrorView
    setFindQuery(view, 'x')
    replaceCurrent(view, 'y')
    replaceAll(view, 'z')
    expect(text(editor)).toEqual(['y z z'])
    editor.undo()
    expect(text(editor)).toEqual(['y x x'])
    editor.undo()
    expect(text(editor)).toEqual(['x x x'])
  })
})
