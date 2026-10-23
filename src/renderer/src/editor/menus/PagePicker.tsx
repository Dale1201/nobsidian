import type { DefaultReactSuggestionItem, SuggestionMenuProps } from '@blocknote/react'
import { Fragment } from 'react'
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
