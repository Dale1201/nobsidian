import { SuggestionMenu } from '@blocknote/core/extensions'
import { useExtension, useExtensionState, type SuggestionMenuProps } from '@blocknote/react'
import { Fragment, useEffect, useRef } from 'react'
import type { SlashItem } from '../slashItems'
import { useSuggestionKeys } from './useSuggestionKeys'

export function SlashMenu({
  items,
  onItemClick,
  loadingState
}: SuggestionMenuProps<SlashItem>): React.JSX.Element {
  const menu = useExtension(SuggestionMenu)
  const { active, setActive } = useSuggestionKeys(items, onItemClick)
  const query = useExtensionState(SuggestionMenu, { selector: (s) => s?.query ?? '' })
  const list = useRef<HTMLDivElement>(null)

  // Like Notion: a space after a query with no matches closes the menu.
  useEffect(() => {
    if (loadingState === 'loaded' && items.length === 0 && query.endsWith(' ')) menu.closeMenu()
  }, [items.length, loadingState, query, menu])

  useEffect(() => {
    list.current?.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div className="menu slash-menu" role="listbox" id="bn-suggestion-menu">
      <div className="slash-menu-list" ref={list}>
        {items.length === 0 && loadingState === 'loaded' && (
          <div className="menu-empty">No results</div>
        )}
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {item.group !== items[i - 1]?.group && <div className="menu-section">{item.group}</div>}
            <button
              type="button"
              role="option"
              aria-label={item.title}
              id={`bn-suggestion-menu-item-${i}`}
              aria-selected={i === active}
              className={`menu-item ${i === active ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => onItemClick?.(item)}
            >
              <span className="menu-item-icon">{item.icon}</span>
              <span className="menu-item-label">{item.title}</span>
              {item.hint && <span className="menu-item-hint">{item.hint}</span>}
            </button>
          </Fragment>
        ))}
      </div>
      <div className="slash-menu-footer">
        <span>Type &apos;/&apos; on the page</span>
        <span>esc</span>
      </div>
    </div>
  )
}
