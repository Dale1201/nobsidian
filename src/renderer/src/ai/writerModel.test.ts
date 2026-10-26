import { describe, expect, it } from 'vitest'
import {
  matchingSkills,
  opensOnSpace,
  placementForText,
  placementOf,
  prefilledSkill,
  skillsFor
} from './writerModel'

describe('skills', () => {
  it('offer edits for a selection and writing for an empty line, in order', () => {
    expect(skillsFor(true).map((s) => s.label)).toEqual([
      'Improve writing',
      'Proofread',
      'Make shorter',
      'Make longer',
      'Simplify language',
      'Change tone to…',
      'Translate to…',
      'Summarize',
      'Explain'
    ])
    expect(skillsFor(false).map((s) => s.label)).toEqual([
      'Continue writing',
      'Summarize page',
      'Translate page to…'
    ])
  })

  it('filter by every typed word', () => {
    const labels = (q: string): string[] => matchingSkills(skillsFor(true), q).map((s) => s.label)
    expect(labels('')).toHaveLength(9)
    expect(labels('make')).toEqual(['Make shorter', 'Make longer'])
    expect(labels('to')).toEqual(['Change tone to…', 'Translate to…'])
    expect(labels('what is QA')).toEqual([])
  })

  it('recognise a finished prefill, and free text that only looks like one', () => {
    const skills = skillsFor(true)
    expect(prefilledSkill(skills, 'Translate to French')?.id).toBe('translate')
    expect(prefilledSkill(skills, 'Translate to ')).toBeNull()
    expect(prefilledSkill(skills, 'Translate this to French')).toBeNull()
    expect(prefilledSkill(skillsFor(false), 'Translate page to German')?.id).toBe('translatePage')
  })

  it('know where results land', () => {
    expect(placementOf('edit')).toBe('edit')
    expect(placementOf('insertBelow')).toBe('insertBelow')
    expect(placementOf('reply')).toBeNull()
    expect(placementForText(true)).toBe('edit')
    expect(placementForText(false)).toBe('insertAtCursor')
  })
})

describe('Space', () => {
  const key = {
    key: ' ',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false
  }
  const line = { type: 'paragraph', empty: true, selectionEmpty: true }

  it('opens the Writer on an empty line of text', () => {
    expect(opensOnSpace(key, line)).toBe(true)
    expect(opensOnSpace(key, { ...line, type: 'heading' })).toBe(true)
    expect(opensOnSpace(key, { ...line, type: 'checkListItem' })).toBe(true)
  })

  it('types a space anywhere else', () => {
    expect(opensOnSpace(key, { ...line, empty: false })).toBe(false)
    expect(opensOnSpace(key, { ...line, type: 'codeBlock' })).toBe(false)
    expect(opensOnSpace(key, { ...line, type: 'table' })).toBe(false)
    expect(opensOnSpace({ ...key, shiftKey: true }, line)).toBe(false)
    expect(opensOnSpace({ ...key, isComposing: true }, line)).toBe(false)
    expect(opensOnSpace({ ...key, key: 'a' }, line)).toBe(false)
  })
})
