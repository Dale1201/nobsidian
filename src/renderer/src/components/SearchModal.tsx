import { useEffect, useMemo, useRef, useState } from 'react'
import { findRanges } from '@shared/core/text'
import type { PageNode, SearchHit, TextRange } from '@shared/types'
import { tabTarget, type LinkClick } from '../lib/navigation'
import { findNode, pathTo } from '../lib/tree'
import { useApp } from '../store'
import { SearchIcon } from './icons'
import { Modal } from './Modal'
import { PageIconView } from './PageIconView'

const api = window.api
const MAX_ITEMS = 50
// Selectors must return stable references, or zustand re-renders forever.
const NONE: string[] = []

interface Item {
  /** null is the top level, offered by the Move to picker. */
  id: string | null
  title: string
  icon?: string
  titleRanges: TextRange[]
  crumbs: string
  snippet: { text: string; ranges: TextRange[] } | null
}

function itemOf(tree: PageNode[], node: PageNode, titleRanges: TextRange[] = []): Item {
  const crumbs = pathTo(tree, node.id)
    .slice(0, -1)
    .map((n) => n.title || 'Untitled')
    .join(' / ')
  return {
    id: node.id,
    title: node.title || 'Untitled',
    icon: node.icon,
    titleRanges,
    crumbs,
    snippet: null
  }
}

/** Ranges of every query term in `title`, or null unless all of them occur. */
function titleMatch(title: string, terms: string[]): TextRange[] | null {
  if (terms.some((t) => findRanges(title, [t]).length === 0)) return null
  return findRanges(title, terms)
}

/** Pages a page can be moved under: everything except itself and its sub-pages. */
function moveTargets(tree: PageNode[], moving: string, terms: string[]): Item[] {
  const out: Item[] = []
  const top = titleMatch('Top level', terms)
  if (top) out.push({ id: null, title: 'Top level', titleRanges: top, crumbs: '', snippet: null })
  const walk = (nodes: PageNode[]): void => {
    for (const n of nodes) {
      if (n.id === moving) continue
      const ranges = titleMatch(n.title || 'Untitled', terms)
      if (ranges) out.push(itemOf(tree, n, ranges))
      walk(n.children)
    }
  }
  walk(tree)
  return out.slice(0, MAX_ITEMS)
}

/** Cmd+K search, or the "Move to" picker when `moving` is a page id. */
export function SearchModal({ moving }: { moving?: string }): React.JSX.Element {
  const tree = useApp((s) => s.tree)
  const workspace = useApp((s) => s.workspace)
  const recent = useApp((s) => (s.workspace && s.settings?.recent[s.workspace.root]) || NONE)
  const close = (): void => useApp.getState().setOverlay(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [answered, setAnswered] = useState('')
  const [selected, setSelected] = useState(0)
  const seq = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (moving || query.trim() === '') return
    const mine = ++seq.current
    const apply = (results: SearchHit[]): void => {
      if (mine !== seq.current) return
      setHits(results)
      setAnswered(query.trim())
    }
    void api.invoke('search:query', { query }).then(apply, () => apply([]))
  }, [query, moving])

  const items = useMemo((): Item[] => {
    const terms = query.trim().split(/\s+/).filter(Boolean)
    if (moving) return moveTargets(tree, moving, terms)
    const ids = terms.length ? hits.map((h) => h.id) : recent
    return ids.flatMap((id, i) => {
      const node = findNode(tree, id)
      if (!node) return []
      const hit = terms.length ? hits[i] : null
      return [{ ...itemOf(tree, node, hit?.titleRanges), snippet: hit?.snippet ?? null }]
    })
  }, [moving, query, hits, tree, recent])

  useEffect(() => {
    listRef.current?.querySelector('.search-item.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const current = Math.min(selected, items.length - 1)

  const choose = (item: Item | undefined, click?: LinkClick): void => {
    if (!item) return
    close()
    const app = useApp.getState()
    if (!moving) {
      if (item.id) app.openPage(item.id, { tab: click ? tabTarget(click) : 'current' })
      return
    }
    const siblings = item.id ? (findNode(app.tree, item.id)?.children ?? []) : app.tree
    void app.movePage(moving, item.id, siblings.filter((n) => n.id !== moving).length)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(Math.min(current + 1, Math.max(items.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(Math.max(current - 1, 0))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      choose(items[current], { button: 0, metaKey: e.metaKey, shiftKey: e.shiftKey })
    }
  }

  const searching = query.trim() !== ''
  return (
    <Modal
      onClose={close}
      className="search"
      label={moving ? 'Move page to' : 'Search'}
      onPanelMouseDown={(e) => e.target instanceof HTMLInputElement || e.preventDefault()}
    >
      <div className="search-input-row">
        <SearchIcon size={18} />
        <input
          className="search-input"
          autoFocus
          placeholder={moving ? 'Move page to…' : `Search ${workspace?.name ?? ''}…`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="search-results" ref={listRef}>
        {!moving && !searching && items.length > 0 && <div className="search-section">Recent</div>}
        {items.map((item, i) => (
          <button
            key={item.id ?? 'top'}
            tabIndex={-1}
            className={`search-item ${i === current ? 'selected' : ''}`}
            onMouseMove={() => i !== current && setSelected(i)}
            onClick={(e) => choose(item, e)}
          >
            <span className="page-icon">
              {item.id === null ? (
                <span className="sidebar-workspace-badge">
                  {workspace?.name.slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <PageIconView icon={item.icon} />
              )}
            </span>
            <span className="search-item-body">
              <span className="search-item-line">
                <span className="search-item-title">
                  <Highlighted text={item.title} ranges={item.titleRanges} />
                </span>
                {item.crumbs && <span className="search-item-crumbs">{item.crumbs}</span>}
              </span>
              {item.snippet && (
                <span className="search-item-snippet">
                  <Highlighted text={item.snippet.text} ranges={item.snippet.ranges} />
                </span>
              )}
            </span>
          </button>
        ))}
        {items.length === 0 && (!searching || moving || answered === query.trim()) && (
          <div className="search-empty">
            {searching ? 'No results' : moving ? 'No pages' : 'Pages you open will show up here'}
          </div>
        )}
      </div>
      <div className="search-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Select
        </span>
        <span>
          <kbd>↵</kbd> {moving ? 'Move' : 'Open'}
        </span>
        <span>
          <kbd>esc</kbd> Close
        </span>
      </div>
    </Modal>
  )
}

function Highlighted({ text, ranges }: { text: string; ranges: TextRange[] }): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(
      <mark key={start} className="search-hit">
        {text.slice(start, end)}
      </mark>
    )
    at = end
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}
