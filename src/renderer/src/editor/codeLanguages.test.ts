import { expect, it } from 'vitest'
import type { Block } from '@shared/core/blocks'
import { createLanguageResolver, withEditorLanguages } from './codeLanguages'

const resolve = createLanguageResolver({
  text: { name: 'Plain Text', aliases: ['text', 'txt'] },
  typescript: { name: 'TypeScript', aliases: ['ts'] }
})

it('maps aliases to highlighter ids and unknown languages to plain text', () => {
  expect(resolve('ts')).toBe('typescript')
  expect(resolve('TypeScript')).toBe('typescript')
  expect(resolve('dockerfile')).toBe('text')
})

it('rewrites nested code blocks', () => {
  const code: Block = { type: 'codeBlock', props: { language: 'ts' }, content: [], children: [] }
  const doc: Block[] = [{ type: 'toggleListItem', props: {}, content: [], children: [code] }]
  expect(withEditorLanguages(doc, resolve)[0].children[0]).toMatchObject({
    props: { language: 'typescript' }
  })
})
