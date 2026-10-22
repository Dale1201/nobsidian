import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions'
import { SideMenu, useExtension, useExtensionState } from '@blocknote/react'
import { useContext, useEffect } from 'react'
import { DragIcon, PlusIcon } from '../../components/icons'
import { useAppEditor } from '../useAppEditor'
import { BlockMenuContext } from './blockMenuContext'

export function AppSideMenu(): React.JSX.Element {
  const editor = useAppEditor()
  const sideMenu = useExtension(SideMenuExtension)
  const suggestionMenu = useExtension(SuggestionMenu)
  const block = useExtensionState(SideMenuExtension, { selector: (s) => s?.block })
  const blockMenu = useContext(BlockMenuContext)

  // BlockNote hides the side menu on any keydown in the editor, so pressing Option for
  // Option-click would hide the + before the click. Window capture runs before its listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <SideMenu>
      <>
        {block && (
          <>
            <button
              type="button"
              className="nb-side-button"
              aria-label="Add a block below"
              title="Click to add below. Option-click to add above."
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                const empty = Array.isArray(block.content) && block.content.length === 0
                const target =
                  empty && !e.altKey
                    ? block
                    : editor.insertBlocks(
                        [{ type: 'paragraph' }],
                        block,
                        e.altKey ? 'before' : 'after'
                      )[0]
                editor.setTextCursorPosition(target)
                suggestionMenu.openSuggestionMenu('/')
              }}
            >
              <PlusIcon size={18} />
            </button>
            <button
              type="button"
              className="nb-side-button nb-drag-handle"
              aria-label="Block menu"
              title="Drag to move. Click to open menu."
              draggable
              onDragStart={(e) => sideMenu.blockDragStart(e, block)}
              onDragEnd={() => sideMenu.blockDragEnd()}
              onClick={(e) => blockMenu.open([block.id], e.currentTarget.getBoundingClientRect())}
            >
              <DragIcon size={16} />
            </button>
          </>
        )}
      </>
    </SideMenu>
  )
}
