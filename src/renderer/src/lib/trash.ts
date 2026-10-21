import type { TrashItem } from '@shared/types'

export function deleteForeverTitle(item: Pick<TrashItem, 'title' | 'pageCount'>): string {
  const subPages = item.pageCount - 1
  const name = item.title || 'Untitled'
  return subPages === 0
    ? `Permanently delete "${name}"?`
    : `Permanently delete "${name}" and its ${subPages} sub-page${subPages === 1 ? '' : 's'}?`
}
