import { SuggestionMenu } from '@blocknote/core/extensions'
import {
  useExtension,
  useExtensionState,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps
} from '@blocknote/react'
import { Fragment, useEffect } from 'react'
import { PlusIcon } from '../../components/icons'
import { PageIconView } from '../../components/PageIconView'
import { useSuggestionKeys } from './useSuggestionKeys'

export type PickerItem = DefaultReactSuggestionItem & {
  key: string
  path?: string
  pageIcon?: string
}

export function PagePicker({
  items,
  onItemClick
}: SuggestionMenuProps<PickerItem>): React.JSX.Element {
  const { active, setActive } = useSuggestionKeys(items, onItemClick)
  const menu = useExtension(SuggestionMenu)
  const query = useExtensionState(SuggestionMenu, { selector: (s) => s?.query ?? '' })
  const trigger = useExtensionState(SuggestionMenu, { selector: (s) => s?.triggerCharacter })
  const hasPages = items.some((item) => item.key !== 'create')

  // After "@", a space first or a phrase naming no page is ordinary writing; "[[" always means a link.
  useEffect(() => {
    if (trigger !== '@') return
    if (query.startsWith(' ') || (query.includes(' ') && !hasPages)) menu.closeMenu()
  }, [trigger, query, hasPages, menu])
  return (
    <div className="menu page-picker" role="listbox">
      <div className="menu-section">Link to page</div>
      {items.length === 0 && <div className="menu-empty">No pages</div>}
      {items.map((item, i) => (
        <Fragment key={item.key}>
          {item.key === 'create' && i > 0 && <div className="menu-separator" />}
          <button
            type="button"
            role="option"
            aria-label={item.title}
            aria-selected={i === active}
            className={`menu-item ${i === active ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => onItemClick?.(item)}
          >
            <span className="menu-item-icon">
              {item.key === 'create' ? (
                <PlusIcon size={16} />
              ) : (
                <PageIconView icon={item.pageIcon} />
              )}
            </span>
            <span className="menu-item-label">{item.title}</span>
            {item.path && <span className="menu-item-hint">{item.path}</span>}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
