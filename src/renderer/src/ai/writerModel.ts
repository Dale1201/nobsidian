import { SKILLS, type Skill, type SkillKind } from '@shared/ai'
import type { Placement } from './pending'

export function skillsFor(selection: boolean): Skill[] {
  return SKILLS.filter((s) => s.selection === selection)
}

/** Skills whose label or words match what was typed; all of them for an empty box. */
export function matchingSkills(skills: Skill[], query: string): Skill[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return skills
  return skills.filter((s) => {
    const label = s.label.toLowerCase().replace('…', '')
    return words.every((w) => label.includes(w))
  })
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

/** Space opens the Writer only at the start of an empty line of text, as in Notion. */
export function opensOnSpace(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>,
  block: { type: string; empty: boolean; selectionEmpty: boolean }
): boolean {
  if (event.key !== ' ' || event.isComposing) return false
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
  return block.selectionEmpty && block.empty && TEXT_BLOCKS.has(block.type)
}
