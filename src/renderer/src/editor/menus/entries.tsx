import { COLOR_NAMES } from '@shared/core/blocks'
import type { MenuEntry } from '../../components/menu/model'
import { DuplicateIcon, PaletteIcon, TrashIcon, TurnIntoIcon } from '../../components/icons'
import { colorBlocks, deleteBlocks, duplicateBlocks, turnIntoBlocks } from '../blockActions'
import type { AppBlock, AppEditor } from '../schema'
import { canTurnInto, currentTurnInto, TURN_INTO } from '../turnInto'

const NAMES: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  file: 'File',
  table: 'Table',
  divider: 'Divider',
  pageLink: 'Page',
  toc: 'Table of contents',
  columnList: 'Columns',
  column: 'Column',
  raw: 'Markdown'
}

const capital = (s: string): string => s[0].toUpperCase() + s.slice(1)

export function blockLabel(block: AppBlock): string {
  const id = currentTurnInto(block)
  return (id && TURN_INTO.find((o) => o.id === id)?.label) || NAMES[block.type] || 'Block'
}

export function turnIntoEntries(editor: AppEditor, blocks: AppBlock[]): MenuEntry[] {
  const current = blocks.length === 1 ? currentTurnInto(blocks[0]) : null
  const ids = blocks.map((b) => b.id)
  return TURN_INTO.map((option) => ({
    kind: 'item',
    id: `turn-${option.id}`,
    label: option.label,
    hint: option.hint,
    checked: option.id === current,
    onSelect: () => turnIntoBlocks(editor, ids, option.id)
  }))
}

export function colorEntries(editor: AppEditor, blocks: AppBlock[]): MenuEntry[] {
  const ids = blocks.map((b) => b.id)
  const text = (color: string, label: string): MenuEntry => ({
    kind: 'item',
    id: `text-${color}`,
    label,
    keywords: ['color', 'text'],
    icon: (
      <span className="menu-color" data-text={color}>
        A
      </span>
    ),
    onSelect: () => colorBlocks(editor, ids, 'textColor', color)
  })
  const background = (color: string, label: string): MenuEntry => ({
    kind: 'item',
    id: `bg-${color}`,
    label,
    keywords: ['color'],
    icon: <span className="menu-color" data-bg={color} />,
    onSelect: () => colorBlocks(editor, ids, 'backgroundColor', color)
  })
  return [
    { kind: 'section', label: 'Text color' },
    text('default', 'Default'),
    ...COLOR_NAMES.map((c) => text(c, capital(c))),
    { kind: 'section', label: 'Background color' },
    background('default', 'Default background'),
    ...COLOR_NAMES.map((c) => background(c, `${capital(c)} background`))
  ]
}

export function blockMenuEntries(editor: AppEditor, blocks: AppBlock[]): MenuEntry[] {
  const ids = blocks.map((b) => b.id)
  const entries: MenuEntry[] = []
  if (blocks.every(canTurnInto)) {
    entries.push({
      kind: 'item',
      id: 'turn-into',
      label: 'Turn into',
      icon: <TurnIntoIcon size={16} />,
      submenu: turnIntoEntries(editor, blocks)
    })
  }
  if (blocks.every((b) => 'textColor' in b.props || 'backgroundColor' in b.props)) {
    entries.push({
      kind: 'item',
      id: 'color',
      label: 'Color',
      icon: <PaletteIcon size={16} />,
      submenu: colorEntries(editor, blocks)
    })
  }
  if (entries.length) entries.push({ kind: 'separator' })
  entries.push(
    {
      kind: 'item',
      id: 'duplicate',
      label: 'Duplicate',
      hint: '⌘D',
      icon: <DuplicateIcon size={16} />,
      onSelect: () => duplicateBlocks(editor, ids)
    },
    {
      kind: 'item',
      id: 'delete',
      label: 'Delete',
      hint: 'Del',
      danger: true,
      icon: <TrashIcon size={16} />,
      onSelect: () => deleteBlocks(editor, ids)
    }
  )
  return entries
}
