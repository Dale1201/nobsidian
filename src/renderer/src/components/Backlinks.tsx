import { useEffect, useState } from 'react'
import { tabTarget } from '../lib/navigation'
import { onPageEvent } from '../lib/pageEvents'
import { pathTo } from '../lib/tree'
import { useApp } from '../store'
import { BacklinkIcon } from './icons'
import { PageIconView } from './PageIconView'
import { Popover } from './Popover'

const api = window.api
const REFRESH_DELAY_MS = 300

/** Ids of the pages linking to `pageId`, kept current as pages are saved, moved or edited. */
function useBacklinks(pageId: string): string[] {
  const [ids, setIds] = useState<string[]>([])
  const tree = useApp((s) => s.tree)
  const [bump, setBump] = useState(0)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const later = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setBump((n) => n + 1), REFRESH_DELAY_MS)
    }
    const offSaved = onPageEvent((e) => e.type === 'saved' && later())
    const offChanged = api.on('page:changed', later)
    return () => {
      if (timer) clearTimeout(timer)
      offSaved()
      offChanged()
    }
  }, [])

  useEffect(() => {
    let current = true
    api.invoke('page:backlinks', { id: pageId }).then(
      (next) => current && setIds((prev) => (sameIds(prev, next) ? prev : next)),
      () => {}
    )
    return () => {
      current = false
    }
  }, [pageId, tree, bump])

  return ids
}

const sameIds = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i])

/** "3 backlinks" under the title, opening a list of the linking pages, like Notion. */
export function Backlinks({ pageId }: { pageId: string }): React.JSX.Element | null {
  const ids = useBacklinks(pageId)
  const tree = useApp((s) => s.tree)
  const openPage = useApp((s) => s.openPage)
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  const pages = ids.flatMap((id) => {
    const path = pathTo(tree, id)
    return path.length ? [{ node: path[path.length - 1], parents: path.slice(0, -1) }] : []
  })
  if (pages.length === 0) return null

  const open = (id: string, click?: React.MouseEvent): void => {
    setAnchor(null)
    openPage(id, { tab: click ? tabTarget(click) : 'current' })
  }

  return (
    <div className="backlinks">
      <button
        ref={setButton}
        className="backlinks-button"
        data-testid="backlinks-button"
        onClick={() => setAnchor((a) => (a ? null : button!.getBoundingClientRect()))}
      >
        <BacklinkIcon size={16} />
        {pages.length === 1 ? '1 backlink' : `${pages.length} backlinks`}
      </button>
      {anchor && (
        <Popover
          anchor={anchor}
          ignore={button}
          onClose={() => setAnchor(null)}
          className="backlinks-popover"
          role="menu"
        >
          {pages.map(({ node, parents }) => (
            <div
              key={node.id}
              className="backlinks-item"
              role="menuitem"
              tabIndex={0}
              data-testid={`backlink-${node.title || 'Untitled'}`}
              onClick={(e) => open(node.id, e)}
              onAuxClick={(e) => e.button === 1 && open(node.id, e)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                open(node.id)
              }}
            >
              <span className="page-icon">
                <PageIconView icon={node.icon} />
              </span>
              <span className="backlinks-item-body">
                <span className="backlinks-item-title">{node.title || 'Untitled'}</span>
                {parents.length > 0 && (
                  <span className="backlinks-item-meta">
                    {parents.map((p) => p.title || 'Untitled').join(' / ')}
                  </span>
                )}
              </span>
            </div>
          ))}
        </Popover>
      )}
    </div>
  )
}
