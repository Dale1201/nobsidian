import { createExtension } from '@blocknote/core'
import { closeHistory } from 'prosemirror-history'
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { findMatches, type Match } from './matches'

export interface FindState {
  query: string
  matches: Match[]
  /** Index into `matches`, or -1 when there are none. */
  current: number
}

type FindMeta =
  | { type: 'query'; query: string }
  | { type: 'step'; by: 1 | -1 }
  /** After a replace: the next match at or after `at` becomes current. */
  | { type: 'after'; at: number }

const key = new PluginKey<FindState>('nbFind')
const EMPTY: FindState = { query: '', matches: [], current: -1 }

/** The first match starting at or after `pos`, wrapping to the first. */
function indexFrom(matches: Match[], pos: number): number {
  if (matches.length === 0) return -1
  const i = matches.findIndex((m) => m.from >= pos)
  return i === -1 ? 0 : i
}

function apply(tr: Transaction, prev: FindState): FindState {
  const meta = tr.getMeta(key) as FindMeta | undefined
  if (meta?.type === 'query') {
    if (meta.query === '') return EMPTY
    const matches = findMatches(tr.doc, meta.query)
    return { query: meta.query, matches, current: indexFrom(matches, tr.selection.from) }
  }
  if (meta?.type === 'step') {
    const n = prev.matches.length
    return n === 0 ? prev : { ...prev, current: (prev.current + meta.by + n) % n }
  }
  if (prev.query === '' || !tr.docChanged) return prev
  const matches = findMatches(tr.doc, prev.query)
  const old = prev.matches[prev.current]
  const at = meta?.type === 'after' ? meta.at : old ? tr.mapping.map(old.from) : 0
  return { query: prev.query, matches, current: indexFrom(matches, at) }
}

function decorations(state: EditorState): DecorationSet {
  const find = key.getState(state)
  if (!find || find.matches.length === 0) return DecorationSet.empty
  return DecorationSet.create(
    state.doc,
    find.matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === find.current ? 'nb-find-match nb-find-current' : 'nb-find-match'
      })
    )
  )
}

export const find = createExtension({
  key: 'nbFind',
  prosemirrorPlugins: [
    new Plugin<FindState>({
      key,
      state: { init: () => EMPTY, apply },
      props: { decorations }
    })
  ]
})

export function findState(state: EditorState): FindState {
  return key.getState(state) ?? EMPTY
}

export function setFindQuery(view: EditorView, query: string): void {
  view.dispatch(view.state.tr.setMeta(key, { type: 'query', query } satisfies FindMeta))
}

export function stepFind(view: EditorView, by: 1 | -1): void {
  view.dispatch(view.state.tr.setMeta(key, { type: 'step', by } satisfies FindMeta))
}

export function replaceCurrent(view: EditorView, text: string): void {
  const { matches, current } = findState(view.state)
  const match = matches[current]
  if (!match) return
  const tr = replaceRange(view.state.tr, match, text)
  view.dispatch(tr.setMeta(key, { type: 'after', at: match.from + text.length } satisfies FindMeta))
}

export function replaceAll(view: EditorView, text: string): void {
  const { matches } = findState(view.state)
  if (matches.length === 0) return
  let tr = view.state.tr
  for (const match of [...matches].reverse()) tr = replaceRange(tr, match, text)
  view.dispatch(tr)
}

// insertText keeps the marks of the replaced text; each replace is its own undo step.
function replaceRange(tr: Transaction, match: Match, text: string): Transaction {
  closeHistory(tr)
  return text === '' ? tr.delete(match.from, match.to) : tr.insertText(text, match.from, match.to)
}

/** Opens collapsed toggles around the current match, then scrolls it to the middle. */
export function revealCurrent(view: EditorView): void {
  const { matches, current } = findState(view.state)
  const match = matches[current]
  if (!match) return
  const $pos = view.state.doc.resolve(match.from)
  let opened = false
  // The block holding the match shows its own text whether open or not.
  for (let d = $pos.depth - 2; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name !== 'blockContainer') continue
    const content = node.firstChild
    const toggles =
      content?.type.name === 'toggleListItem' ||
      (content?.type.name === 'heading' && content.attrs.isToggleable)
    if (!toggles) continue
    const dom = view.nodeDOM($pos.before(d))
    const button = dom instanceof HTMLElement ? dom.querySelector('.bn-toggle-button') : null
    if (button?.getAttribute('aria-expanded') === 'false') {
      ;(button as HTMLElement).click()
      opened = true
    }
  }
  const scroll = (): void =>
    view.dom.querySelector('.nb-find-current')?.scrollIntoView({ block: 'center' })
  if (opened) requestAnimationFrame(scroll)
  else scroll()
}
