import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from '@blocknote/react'
import { getMultiColumnSlashMenuItems } from '@blocknote/xl-multi-column'
import { CalloutIcon, DrawingIcon, PageIcon, SparkleIcon, TocIcon } from '../components/icons'
import { openDrawing } from '../drawing/session'
import type { AppEditor, AppPartialBlock } from './schema'

// The React items carry core's `key` at runtime, but their type omits it.
type KeyedItem = DefaultReactSuggestionItem & { key?: string }

export type SlashItemOptions = {
  createSubPage: () => Promise<string>
  /** Opens the AI Writer; absent while AI is hidden. */
  askAi?: () => void
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

export type SlashItem = DefaultReactSuggestionItem & { key: string; hint?: string }

const LABELS: Record<string, { title: string; hint?: string; aliases?: string[] }> = {
  paragraph: { title: 'Text', aliases: ['text', 'plain'] },
  heading: { title: 'Heading 1', hint: '#' },
  heading_2: { title: 'Heading 2', hint: '##' },
  heading_3: { title: 'Heading 3', hint: '###' },
  bullet_list: { title: 'Bulleted list', hint: '-' },
  numbered_list: { title: 'Numbered list', hint: '1.' },
  check_list: { title: 'To-do list', hint: '[]', aliases: ['todo', 'task', 'checkbox'] },
  toggle_list: { title: 'Toggle list', hint: '>' },
  quote: { title: 'Quote', hint: '"' },
  divider: { title: 'Divider', hint: '---' },
  code_block: { title: 'Code', hint: '```' },
  table: { title: 'Table' },
  toggle_heading: { title: 'Toggle heading 1', hint: '>#' },
  toggle_heading_2: { title: 'Toggle heading 2', hint: '>##' },
  toggle_heading_3: { title: 'Toggle heading 3', hint: '>###' },
  image: { title: 'Image' },
  video: { title: 'Video' },
  audio: { title: 'Audio' },
  file: { title: 'File' },
  two_columns: { title: '2 columns' },
  three_columns: { title: '3 columns' }
}

const ORDER: { group: string; keys: string[] }[] = [
  {
    group: 'Basic blocks',
    keys: [
      'paragraph',
      'page',
      'check_list',
      'heading',
      'heading_2',
      'heading_3',
      'table',
      'bullet_list',
      'numbered_list',
      'toggle_list',
      'quote',
      'divider',
      'callout',
      'code_block'
    ]
  },
  { group: 'Media', keys: ['image', 'drawing', 'video', 'audio', 'file'] },
  {
    group: 'Advanced',
    keys: [
      'toc',
      'math',
      'toggle_heading',
      'toggle_heading_2',
      'toggle_heading_3',
      'two_columns',
      'three_columns'
    ]
  },
  { group: 'AI', keys: ['ask_ai'] }
]

function customItems(editor: AppEditor, opts: SlashItemOptions): SlashItem[] {
  const askAi = opts.askAi
  return [
    ...(askAi
      ? [
          {
            key: 'ask_ai',
            title: 'Ask AI',
            aliases: ['ai', 'ask', 'write', 'claude'],
            icon: <SparkleIcon size={18} />,
            onItemClick: askAi
          }
        ]
      : []),
    {
      key: 'page',
      title: 'Page',
      aliases: ['page', 'subpage', 'link'],
      icon: <PageIcon size={18} />,
      onItemClick: () => void insertPageLink(editor, opts.createSubPage)
    },
    {
      key: 'callout',
      title: 'Callout',
      aliases: ['callout', 'note', 'info', 'tip'],
      icon: <CalloutIcon size={18} />,
      // Converting a paragraph would otherwise carry over its "default" background.
      onItemClick: () =>
        insertOrUpdateBlockForSlashMenu(editor, {
          type: 'callout',
          props: { backgroundColor: 'gray' }
        })
    },
    {
      key: 'drawing',
      title: 'Drawing',
      aliases: ['drawing', 'draw', 'sketch', 'doodle', 'excalidraw', 'whiteboard'],
      icon: <DrawingIcon size={18} />,
      onItemClick: () => {
        const block = insertOrUpdateBlockForSlashMenu(editor, { type: 'drawing' })
        openDrawing(editor, block.id)
      }
    },
    {
      key: 'toc',
      title: 'Table of contents',
      aliases: ['toc', 'outline', 'contents'],
      icon: <TocIcon size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'toc' })
    },
    {
      key: 'math',
      title: 'Block equation',
      aliases: ['math', 'equation', 'latex', 'tex', 'katex'],
      icon: <span>∑</span>,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'math' })
    }
  ]
}

export function getSlashItems(editor: AppEditor, opts: SlashItemOptions): SlashItem[] {
  const byKey = new Map<string, SlashItem>()
  for (const item of getDefaultReactSlashMenuItems(editor) as KeyedItem[]) {
    if (item.key) byKey.set(item.key, { ...item, key: item.key })
  }
  // The multi-column package's items carry no key; it returns two columns, then three.
  const [two, three] = getMultiColumnSlashMenuItems(editor)
  if (two) byKey.set('two_columns', { ...two, key: 'two_columns' })
  if (three) byKey.set('three_columns', { ...three, key: 'three_columns' })
  for (const item of customItems(editor, opts)) byKey.set(item.key, item)
  return ORDER.flatMap(({ group, keys }) =>
    keys.flatMap((key) => {
      const item = byKey.get(key)
      if (!item) return []
      const label = LABELS[key]
      return [
        {
          ...item,
          group,
          title: label?.title ?? item.title,
          hint: label?.hint,
          aliases: [...(item.aliases ?? []), item.title.toLowerCase(), ...(label?.aliases ?? [])],
          badge: undefined,
          subtext: undefined
        }
      ]
    })
  )
}

export async function querySlashItems(
  editor: AppEditor,
  opts: SlashItemOptions,
  query: string
): Promise<SlashItem[]> {
  return filterSuggestionItems(getSlashItems(editor, opts), query)
}
