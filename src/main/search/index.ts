import MiniSearch from 'minisearch'
import { findRanges } from '../../shared/core/text'
import type { SearchHit } from '../../shared/types'

interface SearchDoc {
  id: string
  title: string
  text: string
}

const SNIPPET_LENGTH = 140
const SNIPPET_LEAD = 40

export class SearchIndex {
  private docs = new Map<string, SearchDoc>()
  private mini = new MiniSearch<SearchDoc>({
    fields: ['title', 'text'],
    searchOptions: {
      boost: { title: 2 },
      prefix: true,
      fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
      combineWith: 'AND'
    }
  })

  set(id: string, title: string, text: string): void {
    const doc = { id, title, text }
    if (this.docs.has(id)) this.mini.replace(doc)
    else this.mini.add(doc)
    this.docs.set(id, doc)
  }

  /** Updates a title without touching indexed text (or before the text is known). */
  setTitle(id: string, title: string): void {
    const current = this.docs.get(id)
    if (current?.title === title) return
    this.set(id, title, current?.text ?? '')
  }

  remove(id: string): void {
    if (!this.docs.delete(id)) return
    this.mini.discard(id)
  }

  clear(): void {
    this.docs.clear()
    this.mini.removeAll()
  }

  search(query: string, limit = 50): SearchHit[] {
    if (query.trim() === '') return []
    const results = this.mini.search(query)
    const ranked = results
      .map((r) => ({ r, inTitle: r.terms.some((t) => r.match[t]?.includes('title')) }))
      .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.r.score - a.r.score)
      .slice(0, limit)
    return ranked.map(({ r }) => {
      const doc = this.docs.get(r.id as string)!
      return {
        id: doc.id,
        titleRanges: findRanges(doc.title, r.terms),
        snippet: snippetFor(doc.text, r.terms)
      }
    })
  }
}

function snippetFor(text: string, terms: string[]): SearchHit['snippet'] {
  const first = findRanges(text, terms)[0]
  if (!first) return null
  const lineStart = text.lastIndexOf('\n', first[0] - 1) + 1
  const lineEndAt = text.indexOf('\n', first[0])
  const lineEnd = lineEndAt === -1 ? text.length : lineEndAt
  let start = lineStart
  if (first[0] - start > SNIPPET_LEAD) {
    start = first[0] - SNIPPET_LEAD
    const space = text.indexOf(' ', start)
    if (space !== -1 && space < first[0]) start = space + 1
  }
  let end = Math.min(lineEnd, start + SNIPPET_LENGTH)
  if (end < lineEnd) {
    const space = text.lastIndexOf(' ', end)
    if (space > first[1]) end = space
  }
  const prefix = start > lineStart ? '…' : ''
  const suffix = end < lineEnd ? '…' : ''
  const body = text.slice(start, end)
  return {
    text: prefix + body + suffix,
    ranges: findRanges(body, terms).map(([a, b]) => [a + prefix.length, b + prefix.length])
  }
}
