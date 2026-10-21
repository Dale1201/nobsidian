import { describe, expect, it } from 'vitest'
import { markdownToBlocks } from './parse'
import { blocksText, findRanges } from './text'

const textOf = (md: string): string => blocksText(markdownToBlocks(md))

describe('blocksText', () => {
  it('keeps the words of every block, one block per line', () => {
    expect(
      textOf(
        [
          '# Plan **bold**',
          '',
          '- one [link](https://x.y)',
          '  - nested',
          '',
          '> [!callout] 💡',
          '> Note',
          '',
          '| a | b |',
          '| - | - |',
          '| 1 | 2 |',
          '',
          '```ts',
          'const x = 1',
          '```',
          '',
          '![A cat](attachments/cat.png)',
          ''
        ].join('\n')
      )
    ).toBe('Plan bold\none link\nnested\nNote\na b 1 2\nconst x = 1\nA cat')
  })

  it('includes toggle children and raw Markdown, and skips empty blocks', () => {
    expect(
      textOf(
        '<details>\n<summary>Open</summary>\n\nHidden\n\n</details>\n\n&nbsp;\n\n<nav data-toc></nav>\n\n<section>raw</section>\n'
      )
    ).toBe('Open\nHidden\n<section>raw</section>')
  })
})

describe('findRanges', () => {
  it('matches only at word starts, ignoring case, and merges overlaps', () => {
    expect(findRanges('Plan the PLANET, explain', ['plan', 'planet'])).toEqual([
      [0, 4],
      [9, 15]
    ])
  })
})
