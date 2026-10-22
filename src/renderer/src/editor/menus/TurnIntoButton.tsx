import { useComponentsContext, useSelectedBlocks } from '@blocknote/react'
import { useState } from 'react'
import { ChevronDownIcon } from '../../components/icons'
import { Menu } from '../../components/menu/Menu'
import type { AppBlock } from '../schema'
import { canTurnInto, currentTurnInto, TURN_INTO } from '../turnInto'
import { useAppEditor } from '../useAppEditor'
import { turnIntoEntries } from './entries'

export function TurnIntoButton(): React.JSX.Element | null {
  const Components = useComponentsContext()!
  const editor = useAppEditor()
  const blocks = useSelectedBlocks(editor) as AppBlock[]
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  if (blocks.length === 0 || !blocks.every(canTurnInto)) return null
  const current = currentTurnInto(blocks[0])
  const label = TURN_INTO.find((o) => o.id === current)?.label ?? 'Text'
  return (
    <>
      <Components.FormattingToolbar.Button
        className="bn-button nb-turn-into-button"
        label="Turn into"
        mainTooltip="Turn into"
        isSelected={anchor !== null}
        onClick={(e) => setAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())}
      >
        {label}
        <ChevronDownIcon size={12} />
      </Components.FormattingToolbar.Button>
      {anchor && (
        <Menu
          anchor={anchor}
          entries={turnIntoEntries(editor, blocks)}
          takeFocus={false}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  )
}
