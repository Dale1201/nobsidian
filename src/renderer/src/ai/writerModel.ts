import { SKILLS, type Skill, type SkillKind } from '@shared/ai'
import { filterEntries, type MenuEntry } from '../components/menu/model'
import type { Placement } from './pending'

export function skillsFor(selection: boolean): Skill[] {
  return SKILLS.filter((s) => s.selection === selection)
}

/** Skills whose label or words match what was typed; all of them for an empty box. */
export function matchingSkills(skills: Skill[], query: string): Skill[] {
  const entries: MenuEntry[] = skills.map((s) => ({ kind: 'item', id: s.id, label: s.label }))
  const ids = new Set(filterEntries(entries, query).map((e) => (e.kind === 'item' ? e.id : '')))
  return skills.filter((s) => ids.has(s.id))
}

/** The skill a prefilled prompt belongs to, while the user has kept its opening words. */
export function prefilledSkill(skills: Skill[], query: string): Skill | null {
  return (
    skills.find(
      (s) => s.prefill && query.startsWith(s.prefill) && query.length > s.prefill.length
    ) ?? null
  )
}

export function placementOf(kind: SkillKind): Placement | null {
  return kind === 'reply' ? null : kind
}

/** Typed instructions edit the selection, or write at the cursor; Claude may reply instead. */
export function placementForText(selection: boolean): Placement {
  return selection ? 'edit' : 'insertAtCursor'
}

const TEXT_BLOCKS = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'quote'
])

type SpaceEvent = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'
>

/** A bare Space, which is cheap to check before looking at the block it was typed in. */
export function isPlainSpace(event: SpaceEvent): boolean {
  if (event.key !== ' ' || event.isComposing) return false
  return !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
}

/** Space opens the Writer only at the start of an empty line of text, as in Notion. */
export function opensOnSpace(
  event: SpaceEvent,
  block: { type: string; empty: boolean; selectionEmpty: boolean }
): boolean {
  return isPlainSpace(event) && block.selectionEmpty && block.empty && TEXT_BLOCKS.has(block.type)
}
