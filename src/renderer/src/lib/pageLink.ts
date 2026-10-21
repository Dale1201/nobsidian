import { useMemo } from 'react'
import { pageIdFromHref } from '@shared/core/links'
import type { PageLinkContextValue } from '../editor/schema'
import { useApp } from '../store'
import { openHref } from './navigation'
import { findNode } from './tree'

export function usePageLink(): PageLinkContextValue {
  const tree = useApp((s) => s.tree)
  return useMemo(
    () => ({
      resolve: (href) => {
        const id = pageIdFromHref(href)
        const node = id ? findNode(tree, id) : null
        return node ? { title: node.title || 'Untitled', icon: node.icon } : null
      },
      open: openHref
    }),
    [tree]
  )
}
