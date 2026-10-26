import { expect, it, vi } from 'vitest'
import { contextMenuTemplate, type ContextMenuInfo, type SpellingActions } from './contextMenu'

const editFlags = {
  canUndo: true,
  canRedo: false,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true,
  canEditRichly: true
}
const text: ContextMenuInfo = {
  misspelledWord: '',
  dictionarySuggestions: [],
  isEditable: true,
  editFlags,
  selectionText: ''
}
const spelling = (): SpellingActions => ({ replace: vi.fn(), learn: vi.fn() })
const labels = (info: ContextMenuInfo): (string | undefined)[] =>
  contextMenuTemplate(info, spelling()).map((item) => item.label ?? item.role ?? item.type)

it('puts spelling fixes above the edit actions', () => {
  const info = { ...text, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'] }
  expect(labels(info)).toEqual([
    'the',
    'ten',
    'separator',
    'Learn Spelling',
    'separator',
    'cut',
    'copy',
    'paste'
  ])
})

it('replaces with the chosen fix and learns the misspelled word', () => {
  const actions = spelling()
  const items = contextMenuTemplate(
    { ...text, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'] },
    actions
  )
  const click = (label: string): void =>
    (items.find((item) => item.label === label)?.click as () => void)()
  click('ten')
  expect(actions.replace).toHaveBeenCalledWith('ten')
  click('Learn Spelling')
  expect(actions.learn).toHaveBeenCalledWith('teh')
})

it('says when there are no fixes', () => {
  const items = contextMenuTemplate({ ...text, misspelledWord: 'qzxv' }, spelling())
  expect(items[0]).toEqual({ label: 'No Guesses Found', enabled: false })
})

it('follows the edit flags', () => {
  const items = contextMenuTemplate(
    { ...text, editFlags: { ...editFlags, canCut: false, canCopy: false } },
    spelling()
  )
  expect(items.map((item) => [item.role, item.enabled])).toEqual([
    ['cut', false],
    ['copy', false],
    ['paste', true]
  ])
})

it('offers Copy for selected read-only text and nothing otherwise', () => {
  expect(labels({ ...text, isEditable: false, selectionText: 'words' })).toEqual(['copy'])
  expect(labels({ ...text, isEditable: false })).toEqual([])
})
