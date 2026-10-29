import type { Node } from 'prosemirror-model'
import type { EditorState } from 'prosemirror-state'

export interface Match {
  from: number
  to: number
}

// One character per leaf, so offsets in a text block's text are offsets into its content.
const OBJECT = '￼'

/** Lowercases without changing length, so offsets still line up (e.g. "İ" stays as it is). */
export function fold(text: string): string {
  let out = ''
  for (const c of text) {
    const lower = c.toLowerCase()
    out += lower.length === c.length ? lower : c
  }
  return out
}

/** Every case-insensitive occurrence of `query` within one text block, in document order. */
export function findMatches(doc: Node, query: string): Match[] {
  if (query === '') return []
  const needle = fold(query)
  const out: Match[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const text = fold(node.textBetween(0, node.content.size, undefined, OBJECT))
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
      out.push({ from: pos + 1 + i, to: pos + 1 + i + needle.length })
    }
    return false
  })
  return out
}

/** Text selected within one block to search for; none when it holds a chip no query can match. */
export function selectionQuery({ selection, doc }: EditorState): string {
  if (selection.empty || selection.$from.parent !== selection.$to.parent) return ''
  const text = doc.textBetween(selection.from, selection.to, undefined, OBJECT)
  return text.includes(OBJECT) ? '' : text
}
