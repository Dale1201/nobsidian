import type { Inline } from '@shared/core/blocks'
import { inlineText } from '@shared/core/text'

export type TurnIntoId =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'toggle'
  | 'toggleHeading1'
  | 'toggleHeading2'
  | 'toggleHeading3'
  | 'code'
  | 'quote'
  | 'callout'
  | 'math'

export interface TurnIntoOption {
  id: TurnIntoId
  label: string
  /** Notion's Markdown shortcut for the type. */
  hint?: string
  type: string
  props?: Record<string, unknown>
}

export interface TurnIntoBlock {
  type: string
  props: Record<string, unknown>
  content?: unknown
}

export interface TurnIntoUpdate {
  type: string
  props: Record<string, unknown>
  content?: string
}

const heading = (level: number, isToggleable: boolean): Record<string, unknown> => ({
  level,
  isToggleable
})

export const TURN_INTO: TurnIntoOption[] = [
  { id: 'paragraph', label: 'Text', type: 'paragraph' },
  { id: 'heading1', label: 'Heading 1', hint: '#', type: 'heading', props: heading(1, false) },
  { id: 'heading2', label: 'Heading 2', hint: '##', type: 'heading', props: heading(2, false) },
  { id: 'heading3', label: 'Heading 3', hint: '###', type: 'heading', props: heading(3, false) },
  { id: 'bullet', label: 'Bulleted list', hint: '-', type: 'bulletListItem' },
  { id: 'numbered', label: 'Numbered list', hint: '1.', type: 'numberedListItem' },
  { id: 'todo', label: 'To-do list', hint: '[]', type: 'checkListItem' },
  { id: 'toggle', label: 'Toggle list', hint: '>', type: 'toggleListItem' },
  {
    id: 'toggleHeading1',
    label: 'Toggle heading 1',
    hint: '>#',
    type: 'heading',
    props: heading(1, true)
  },
  {
    id: 'toggleHeading2',
    label: 'Toggle heading 2',
    hint: '>##',
    type: 'heading',
    props: heading(2, true)
  },
  {
    id: 'toggleHeading3',
    label: 'Toggle heading 3',
    hint: '>###',
    type: 'heading',
    props: heading(3, true)
  },
  { id: 'code', label: 'Code', hint: '```', type: 'codeBlock' },
  { id: 'quote', label: 'Quote', hint: '"', type: 'quote' },
  { id: 'callout', label: 'Callout', type: 'callout' },
  { id: 'math', label: 'Block equation', type: 'math' }
]

const TEXT_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'quote',
  'callout'
])
// Code blocks keep plain text and equations keep LaTeX, so neither has colours or inline content.
const PLAIN_TYPES = new Set(['codeBlock', 'math'])

export function canTurnInto(block: TurnIntoBlock): boolean {
  return TEXT_TYPES.has(block.type) || PLAIN_TYPES.has(block.type)
}

export function currentTurnInto(block: TurnIntoBlock): TurnIntoId | null {
  if (block.type === 'heading') {
    const level = Number(block.props.level)
    if (level < 1 || level > 3) return null
    return `${block.props.isToggleable ? 'toggleHeading' : 'heading'}${level}` as TurnIntoId
  }
  return TURN_INTO.find((o) => o.type === block.type)?.id ?? null
}

function textOf(block: TurnIntoBlock): string {
  if (block.type === 'math') return String(block.props.latex ?? '')
  return Array.isArray(block.content) ? inlineText(block.content as Inline[]) : ''
}

export function turnIntoUpdate(block: TurnIntoBlock, id: TurnIntoId): TurnIntoUpdate {
  const option = TURN_INTO.find((o) => o.id === id)!
  if (option.type === 'math') return { type: 'math', props: { latex: textOf(block) } }
  const colors: Record<string, unknown> = {}
  if (TEXT_TYPES.has(option.type)) {
    if (block.props.textColor !== undefined) colors.textColor = block.props.textColor
    if (block.props.backgroundColor !== undefined) {
      colors.backgroundColor = block.props.backgroundColor
    }
  }
  if (
    option.type === 'callout' &&
    (!colors.backgroundColor || colors.backgroundColor === 'default')
  ) {
    colors.backgroundColor = 'gray'
  }
  const update: TurnIntoUpdate = { type: option.type, props: { ...colors, ...option.props } }
  if (PLAIN_TYPES.has(block.type) || option.type === 'codeBlock') update.content = textOf(block)
  return update
}
