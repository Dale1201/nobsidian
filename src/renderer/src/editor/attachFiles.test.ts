import { describe, expect, it } from 'vitest'
import type { Block } from '@shared/core/blocks'
import { inlinePaste } from './attachFiles'

const words = [{ type: 'text' as const, text: 'pasted words', styles: { bold: true } }]
const paragraph = (props: Block['props'] = {}, children: Block[] = []): Block =>
  ({ type: 'paragraph', props, content: words, children }) as Block

describe('inlinePaste', () => {
  it('takes one plain paragraph as text for the cursor', () => {
    expect(inlinePaste([paragraph()])).toEqual(words)
    expect(inlinePaste([paragraph({ textColor: 'default' })])).toEqual(words)
  })

  it('keeps blocks, colors and nesting as blocks', () => {
    expect(inlinePaste([paragraph(), paragraph()])).toBeNull()
    expect(inlinePaste([paragraph({ backgroundColor: 'yellow' })])).toBeNull()
    expect(inlinePaste([paragraph({}, [paragraph()])])).toBeNull()
    expect(
      inlinePaste([{ type: 'heading', props: { level: 1 }, content: words, children: [] }])
    ).toBeNull()
  })
})
