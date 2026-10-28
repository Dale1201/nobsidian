import { describe, expect, it } from 'vitest'
import type { Block } from './blocks'
import { pageLinkHref } from './links'
import {
  appendSubPageLink,
  insertSubPageLinkAfter,
  insertSubPageLinkAt,
  removeSubPageLinks,
  subPageLinkPath
} from './subpages'

const link = (id: string): Block => ({
  type: 'pageLink',
  props: { href: pageLinkHref(id) },
  children: []
})
const text = (t: string, children: Block[] = []): Block => ({
  type: 'paragraph',
  props: {},
  content: t ? [{ type: 'text', text: t, styles: {} }] : [],
  children
})
const column = (children: Block[]): Block => ({ type: 'column', props: { width: 1 }, children })

describe('sub-page links', () => {
  it('append above trailing empty lines', () => {
    expect(appendSubPageLink([text('a'), text(''), text('')], 'x')).toEqual([
      text('a'),
      link('x'),
      text(''),
      text('')
    ])
    expect(appendSubPageLink([], 'x')).toEqual([link('x')])
  })

  it('are not added twice, even when nested', () => {
    expect(appendSubPageLink([text('a', [link('x')])], 'x')).toBeNull()
    expect(insertSubPageLinkAfter([link('a'), link('x')], 'a', 'x')).toBeNull()
  })

  it('go right after the first link to the original, nested or not', () => {
    expect(insertSubPageLinkAfter([text('t', [link('a')]), link('a')], 'a', 'b')).toEqual([
      text('t', [link('a'), link('b')]),
      link('a')
    ])
    expect(insertSubPageLinkAfter([text('t')], 'a', 'b')).toEqual([text('t'), link('b')])
  })

  it('are removed everywhere, leaving a column something to show', () => {
    const blocks = [link('x'), text('t', [link('x')]), column([link('x')])]
    expect(removeSubPageLinks(blocks, 'x')).toEqual([text('t'), column([text('')])])
    expect(removeSubPageLinks([text('t')], 'x')).toBeNull()
  })

  it('are found by index path, nested or not', () => {
    expect(subPageLinkPath([text('t'), link('x')], 'x')).toEqual([1])
    expect(subPageLinkPath([text('t'), column([text('u'), link('x')])], 'x')).toEqual([1, 1])
    expect(subPageLinkPath([text('t')], 'x')).toBeNull()
  })

  it('go back at their index path, or at the end once it no longer fits', () => {
    expect(insertSubPageLinkAt([text('a'), text('b')], 'x', [1])).toEqual([
      text('a'),
      link('x'),
      text('b')
    ])
    expect(insertSubPageLinkAt([text('a'), column([text('u')])], 'x', [1, 1])).toEqual([
      text('a'),
      column([text('u'), link('x')])
    ])
    expect(insertSubPageLinkAt([text('a'), text('')], 'x', [5])).toEqual([
      text('a'),
      link('x'),
      text('')
    ])
    expect(insertSubPageLinkAt([text('a')], 'x', [3, 0])).toEqual([text('a'), link('x')])
    expect(insertSubPageLinkAt([link('x')], 'x', [0])).toBeNull()
  })
})
