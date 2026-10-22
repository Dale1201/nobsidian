import { describe, expect, it } from 'vitest'
import { canTurnInto, currentTurnInto, TURN_INTO, turnIntoUpdate } from './turnInto'

const text = (t: string): unknown[] => [{ type: 'text', text: t, styles: {} }]

describe('turn into', () => {
  it('lists Notion options in Notion order with their shortcuts', () => {
    expect(TURN_INTO.map((o) => o.label)).toEqual([
      'Text',
      'Heading 1',
      'Heading 2',
      'Heading 3',
      'Bulleted list',
      'Numbered list',
      'To-do list',
      'Toggle list',
      'Toggle heading 1',
      'Toggle heading 2',
      'Toggle heading 3',
      'Code',
      'Quote',
      'Callout',
      'Block equation'
    ])
    expect(TURN_INTO.find((o) => o.id === 'toggle')?.hint).toBe('>')
  })

  it('names the current type, telling toggle headings apart', () => {
    expect(currentTurnInto({ type: 'heading', props: { level: 2 } })).toBe('heading2')
    expect(currentTurnInto({ type: 'heading', props: { level: 1, isToggleable: true } })).toBe(
      'toggleHeading1'
    )
    expect(currentTurnInto({ type: 'heading', props: { level: 5 } })).toBeNull()
    expect(currentTurnInto({ type: 'image', props: {} })).toBeNull()
  })

  it('only converts blocks with text', () => {
    expect(canTurnInto({ type: 'paragraph', props: {} })).toBe(true)
    expect(canTurnInto({ type: 'math', props: {} })).toBe(true)
    expect(canTurnInto({ type: 'table', props: {} })).toBe(false)
    expect(canTurnInto({ type: 'image', props: {} })).toBe(false)
  })

  it('keeps colours where the new type has them', () => {
    const block = { type: 'paragraph', props: { textColor: 'red', backgroundColor: 'yellow' } }
    expect(turnIntoUpdate(block, 'bullet')).toEqual({
      type: 'bulletListItem',
      props: { textColor: 'red', backgroundColor: 'yellow' }
    })
    expect(turnIntoUpdate(block, 'heading1').props).toEqual({
      textColor: 'red',
      backgroundColor: 'yellow',
      level: 1,
      isToggleable: false
    })
  })

  it('gives callouts a gray background unless the block had one', () => {
    expect(turnIntoUpdate({ type: 'paragraph', props: {} }, 'callout').props.backgroundColor).toBe(
      'gray'
    )
    expect(
      turnIntoUpdate({ type: 'paragraph', props: { backgroundColor: 'blue' } }, 'callout').props
        .backgroundColor
    ).toBe('blue')
  })

  it('moves text into code and equations and back out', () => {
    const para = { type: 'paragraph', props: {}, content: text('x^2') }
    expect(turnIntoUpdate(para, 'code')).toEqual({ type: 'codeBlock', props: {}, content: 'x^2' })
    expect(turnIntoUpdate(para, 'math')).toEqual({ type: 'math', props: { latex: 'x^2' } })
    expect(turnIntoUpdate({ type: 'math', props: { latex: 'y' } }, 'paragraph')).toEqual({
      type: 'paragraph',
      props: {},
      content: 'y'
    })
    expect(turnIntoUpdate({ type: 'codeBlock', props: {}, content: text('a') }, 'quote')).toEqual({
      type: 'quote',
      props: {},
      content: 'a'
    })
  })
})
