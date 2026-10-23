import type { Transaction } from 'prosemirror-state'
import { useCallback } from 'react'
import { pageLinkHref } from '@shared/core/links'
import type { PageNode } from '@shared/types'
import { useApp } from '../store'
import type { PickerItem } from './menus/PagePicker'
import { rankPages, type PickerPage } from './pagePickerItems'
import type { AppEditor } from './schema'

// Selectors must return stable references, or zustand re-renders forever.
const NO_RECENT: string[] = []

function flattenPages(nodes: PageNode[], parents: string[] = []): PickerPage[] {
  return nodes.flatMap((n) => [
    { id: n.id, title: n.title, icon: n.icon, path: parents.join(' / ') },
    ...flattenPages(n.children, [...parents, n.title || 'Untitled'])
  ])
}

/** `@` opens the picker only at the start of a word, as in Notion, so email addresses stay text. */
export function opensAtWordStart(tr: Transaction): boolean {
  const { $from } = tr.selection
  if ($from.parentOffset === 0) return true
  const before = $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset, '\n', ' ')
  return /\s/.test(before)
}

/** Items for the `@` and `[[` page picker: matching pages, then a new page with the query as title. */
export function usePickerItems(
  editor: AppEditor,
  createLinkedPage?: (title: string) => Promise<string>
): (query: string) => Promise<PickerItem[]> {
  const tree = useApp((s) => s.tree)
  const recent = useApp((s) => (s.workspace && s.settings?.recent[s.workspace.root]) || NO_RECENT)
  return useCallback(
    async (query: string) => {
      const insert = (href: string, title: string): void => {
        editor.insertInlineContent([{ type: 'pageMention', props: { href, title } }, ' '])
      }
      const items: PickerItem[] = rankPages(flattenPages(tree), recent, query).map((p) => ({
        key: p.id,
        title: p.title || 'Untitled',
        path: p.path,
        pageIcon: p.icon,
        onItemClick: () => insert(pageLinkHref(p.id), p.title)
      }))
      const title = query.trim()
      if (title && createLinkedPage) {
        items.push({
          key: 'create',
          title: `New page "${title}"`,
          onItemClick: () => void createLinkedPage(title).then((href) => insert(href, title))
        })
      }
      return items
    },
    [editor, tree, recent, createLinkedPage]
  )
}
