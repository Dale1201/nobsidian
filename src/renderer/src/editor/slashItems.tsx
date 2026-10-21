import {
  combineByGroup,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu
} from '@blocknote/core'
import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from '@blocknote/react'
import { getMultiColumnSlashMenuItems } from '@blocknote/xl-multi-column'
import { TocIcon } from '../components/icons'
import type { AppEditor, AppPartialBlock } from './schema'

// The React items carry core's `key` at runtime, but their type omits it.
type KeyedItem = DefaultReactSuggestionItem & { key?: string }

const EXCLUDED_KEYS = new Set([
  'heading_4',
  'heading_5',
  'heading_6',
  'toggle_heading_4',
  'toggle_heading_5',
  'toggle_heading_6'
])

// The menu draws a group header whenever the group changes, so groups must be contiguous.
function groupAdjacent<T extends { group?: string }>(items: T[]): T[] {
  const order = new Map<string | undefined, number>()
  for (const item of items) {
    if (!order.has(item.group)) order.set(item.group, order.size)
  }
  return [...items].sort((a, b) => order.get(a.group)! - order.get(b.group)!)
}

export type SlashItemOptions = {
  createSubPage: () => Promise<string>
}

// The suggestion menu removes the "/" query before onItemClick runs, so the
// block under the cursor is the one the menu was opened in.
async function insertPageLink(
  editor: AppEditor,
  createSubPage: () => Promise<string>
): Promise<void> {
  const originId = editor.getTextCursorPosition().block.id
  const href = await createSubPage()
  const block: AppPartialBlock = { type: 'pageLink', props: { href } }
  if (editor.getBlock(originId)) {
    editor.setTextCursorPosition(originId, 'end')
    insertOrUpdateBlockForSlashMenu(editor, block)
  } else {
    const last = editor.document[editor.document.length - 1]
    editor.insertBlocks([block], last, 'after')
  }
}

export function getSlashItems(
  editor: AppEditor,
  opts: SlashItemOptions
): DefaultReactSuggestionItem[] {
  const defaults = groupAdjacent(
    getDefaultReactSlashMenuItems(editor)
      .filter((item: KeyedItem) => !(item.key && EXCLUDED_KEYS.has(item.key)))
      .map((item: KeyedItem) =>
        item.key?.startsWith('toggle_heading') ? { ...item, group: 'Headings' } : item
      )
  )

  const custom: DefaultReactSuggestionItem[] = [
    {
      title: 'Page',
      subtext: 'Embed a sub-page inside this page',
      aliases: ['page', 'subpage', 'link'],
      group: 'Basic blocks',
      icon: <span>📄</span>,
      onItemClick: () => {
        void insertPageLink(editor, opts.createSubPage)
      }
    },
    {
      title: 'Callout',
      subtext: 'Make writing stand out',
      aliases: ['callout', 'note', 'info', 'tip'],
      group: 'Basic blocks',
      icon: <span>💡</span>,
      onItemClick: () => {
        // Converting a paragraph would otherwise carry over its "default" background.
        insertOrUpdateBlockForSlashMenu(editor, {
          type: 'callout',
          props: { backgroundColor: 'gray' }
        })
      }
    },
    {
      title: 'Table of contents',
      subtext: 'Show an outline of your page',
      aliases: ['toc', 'outline', 'contents'],
      group: 'Advanced',
      icon: <TocIcon size={18} />,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, { type: 'toc' })
      }
    },
    {
      title: 'Block equation',
      subtext: 'Display a standalone math equation',
      aliases: ['math', 'equation', 'latex', 'tex', 'katex'],
      group: 'Advanced',
      icon: <span>∑</span>,
      onItemClick: () => {
        insertOrUpdateBlockForSlashMenu(editor, { type: 'math' })
      }
    }
  ]

  return combineByGroup(defaults, getMultiColumnSlashMenuItems(editor), custom)
}

export async function querySlashItems(
  editor: AppEditor,
  opts: SlashItemOptions,
  query: string
): Promise<DefaultReactSuggestionItem[]> {
  return filterSuggestionItems(getSlashItems(editor, opts), query)
}
