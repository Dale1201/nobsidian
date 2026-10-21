import { describe, expect, it } from 'vitest'
import { SearchIndex } from './index'

function index(): SearchIndex {
  const ix = new SearchIndex()
  ix.set('a', 'Groceries', 'Buy apples and a project notebook')
  ix.set('b', 'Project plan', 'Milestones for the launch')
  ix.set('c', 'Ideas', 'Random thoughts')
  return ix
}

describe('SearchIndex', () => {
  it('ranks title matches above content matches', () => {
    expect(
      index()
        .search('project')
        .map((h) => h.id)
    ).toEqual(['b', 'a'])
  })

  it('matches word prefixes and tolerates small typos in longer words', () => {
    const ix = index()
    expect(ix.search('proj').map((h) => h.id)).toEqual(['b', 'a'])
    expect(ix.search('milestnes').map((h) => h.id)).toEqual(['b'])
    expect(ix.search('ide').map((h) => h.id)).toEqual(['c'])
  })

  it('requires every word of the query', () => {
    expect(
      index()
        .search('project launch')
        .map((h) => h.id)
    ).toEqual(['b'])
  })

  it('returns highlight ranges for the title and a snippet around the first content match', () => {
    const [hit] = index().search('apples')
    expect(hit).toEqual({
      id: 'a',
      titleRanges: [],
      snippet: { text: 'Buy apples and a project notebook', ranges: [[4, 10]] }
    })
    const [title] = index().search('plan')
    expect(title.titleRanges).toEqual([[8, 12]])
    expect(title.snippet).toBeNull()
  })

  it('trims long lines around the match', () => {
    const ix = new SearchIndex()
    const long = `${'word '.repeat(30)}needle ${'tail '.repeat(40)}`.trim()
    ix.set('x', 'Long', `First line\n${long}\nLast line`)
    const snippet = ix.search('needle')[0].snippet!
    expect(snippet.text.startsWith('…word')).toBe(true)
    expect(snippet.text.endsWith('…')).toBe(true)
    expect(snippet.text.length).toBeLessThanOrEqual(142)
    const [a, b] = snippet.ranges[0]
    expect(snippet.text.slice(a, b)).toBe('needle')
  })

  it('updates titles and text, and forgets removed pages', () => {
    const ix = index()
    ix.setTitle('c', 'Project ideas')
    expect(ix.search('random').map((h) => h.id)).toEqual(['c'])
    expect(ix.search('project')[0].id).toBe('b')
    expect(ix.search('project').map((h) => h.id)).toContain('c')
    ix.set('c', 'Project ideas', 'Different words')
    expect(ix.search('random')).toEqual([])
    ix.remove('b')
    expect(ix.search('milestones')).toEqual([])
    expect(ix.search('   ')).toEqual([])
  })
})
