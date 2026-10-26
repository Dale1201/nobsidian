import { describe, expect, it } from 'vitest'
import type { AiStart } from '../../shared/ai'
import {
  firstMessage,
  followUpMessage,
  instructionText,
  modeFor,
  PAGE_LIMIT,
  SYSTEM_PROMPT,
  toolsFor,
  trimPage
} from './prompts'

const start = (over: Partial<AiStart>): AiStart => ({
  sessionId: 's',
  requestId: 'r',
  title: 'Notes',
  markdown: 'Intro.\n\n⟦selection⟧A long sentence.⟦/selection⟧\n\nOutro.',
  selection: true,
  ...over
})

describe('messages', () => {
  it('sends the page first, marked for caching, then the instruction', () => {
    const message = firstMessage(start({ skill: 'shorter' }))
    expect(message.role).toBe('user')
    expect(message.content).toEqual([
      {
        type: 'text',
        text: '<page title="Notes">\nIntro.\n\n⟦selection⟧A long sentence.⟦/selection⟧\n\nOutro.\n</page>',
        cache_control: { type: 'ephemeral' }
      },
      { type: 'text', text: 'Make the selection about half as long, keeping every key point.' }
    ])
  })

  it('escapes the title', () => {
    const message = firstMessage(start({ title: 'A "b" <c> & d', skill: 'improve' }))
    const page = (message.content as { text: string }[])[0].text
    expect(page.startsWith('<page title="A &quot;b&quot; &lt;c> &amp; d">')).toBe(true)
  })

  it('keeps dates out of the system prompt, and tells Claude never to write the markers', () => {
    expect(SYSTEM_PROMPT).toContain('never write them')
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('finishes a prefilled skill with the words the user typed', () => {
    expect(instructionText(start({ skill: 'translate', instruction: 'Translate to French' }))).toBe(
      'Translate to French. Apply it to the selection.'
    )
    expect(
      instructionText(start({ skill: 'translatePage', instruction: 'Translate page to German ' }))
    ).toBe('Translate page to German. The result replaces the whole page, so write all of it.')
  })

  it('gives free text the tools to change the page or reply, and skills none', () => {
    expect(toolsFor(start({ skill: 'improve' }))).toBeNull()
    expect(toolsFor(start({ instruction: 'what is this?' }))!.map((t) => t.name)).toEqual([
      'edit',
      'reply'
    ])
    expect(
      toolsFor(start({ instruction: 'write a haiku', selection: false }))!.map((t) => t.name)
    ).toEqual(['insert', 'reply'])
    const tool = toolsFor(start({ instruction: 'x' }))![0]
    expect(tool.strict).toBe(true)
    expect(tool.eager_input_streaming).toBe(true)
    const text = (
      firstMessage(start({ instruction: 'what is this?' })).content as { text: string }[]
    )[1].text
    expect(text).toBe('what is this?\n\nCall exactly one of the tools edit or reply.')
  })

  it('knows the mode of a skill before Claude answers', () => {
    expect(modeFor(start({ skill: 'improve' }))).toBe('edit')
    expect(modeFor(start({ skill: 'summarize' }))).toBe('insert')
    expect(modeFor(start({ skill: 'explain' }))).toBe('reply')
    expect(modeFor(start({ skill: 'translatePage', instruction: 'Translate page to Dutch' }))).toBe(
      'edit'
    )
    expect(modeFor(start({ instruction: 'x' }))).toBeNull()
  })

  it('answers each tool call of the last turn before asking for a revision', () => {
    const message = followUpMessage(
      [
        { type: 'thinking', thinking: '', signature: 'sig' },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'edit',
          input: { markdown: 'x' },
          caller: { type: 'direct' }
        }
      ] as never,
      ' more formal '
    )
    expect(message.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'Shown to the user.' },
      { type: 'text', text: 'Revise your last result: more formal\nGive the whole revised result.' }
    ])
  })
})

describe('trimPage', () => {
  it('leaves a page within the limit alone', () => {
    expect(trimPage('short')).toBe('short')
  })

  it('keeps the text around the selection of a huge page', () => {
    const before = 'a'.repeat(PAGE_LIMIT)
    const after = 'b'.repeat(PAGE_LIMIT)
    const trimmed = trimPage(`${before}⟦selection⟧X⟦/selection⟧${after}`)
    expect(trimmed.startsWith('[…]\n')).toBe(true)
    expect(trimmed.endsWith('\n[…]')).toBe(true)
    expect(trimmed).toContain('⟦selection⟧X⟦/selection⟧')
    expect(trimmed.length).toBe(PAGE_LIMIT + 8)
  })

  it('keeps both ends of a long selection', () => {
    const selected = 'x'.repeat(PAGE_LIMIT * 0.8)
    const trimmed = trimPage(`${'a'.repeat(PAGE_LIMIT)}⟦selection⟧${selected}⟦/selection⟧tail`)
    expect(trimmed).toContain(`⟦selection⟧${selected}⟦/selection⟧`)
    expect(trimmed.length).toBeLessThanOrEqual(PAGE_LIMIT + 8)
  })

  it('closes a selection longer than the limit where it is cut', () => {
    const trimmed = trimPage(`intro ⟦selection⟧${'x'.repeat(PAGE_LIMIT * 2)}⟦/selection⟧ outro`)
    expect(trimmed.indexOf('⟦selection⟧')).toBeLessThan(trimmed.indexOf('⟦/selection⟧'))
    expect(trimmed).toContain('[…]\n⟦/selection⟧')
    expect(trimmed.endsWith('\n[…]')).toBe(true)
  })

  it('keeps the start of a huge page with no marker', () => {
    const trimmed = trimPage('c'.repeat(PAGE_LIMIT * 2))
    expect(trimmed.startsWith('ccc')).toBe(true)
    expect(trimmed.endsWith('\n[…]')).toBe(true)
  })
})
