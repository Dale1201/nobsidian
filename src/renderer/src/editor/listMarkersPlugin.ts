import { createExtension } from '@blocknote/core'
import type { Node } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { bulletMarker, numberMarker } from './listMarkers'

const key = new PluginKey<DecorationSet>('nbListMarkers')

interface Depths {
  bullet: number
  number: number
}

// Containers can sit in block groups, columns or column lists, so every node is walked.
function markers(doc: Node): DecorationSet {
  const decorations: Decoration[] = []
  const visit = (parent: Node, start: number, depths: Depths): void => {
    let previous: number | null = null
    parent.forEach((child, offset) => {
      const pos = start + offset
      if (child.type.name !== 'blockContainer') {
        previous = null
        visit(child, pos + 1, depths)
        return
      }
      const content = child.firstChild
      if (!content) return
      const contentPos = pos + 1
      const next = { ...depths }
      if (content.type.name === 'bulletListItem') {
        decorations.push(
          Decoration.node(contentPos, contentPos + content.nodeSize, {
            'data-marker': bulletMarker(depths.bullet)
          })
        )
        next.bullet++
        previous = null
      } else if (content.type.name === 'numberedListItem') {
        const index = previous === null ? Number(content.attrs.start) || 1 : previous + 1
        decorations.push(
          Decoration.node(contentPos, contentPos + content.nodeSize, {
            'data-marker': numberMarker(index, depths.number)
          })
        )
        next.number++
        previous = index
      } else {
        previous = null
      }
      const group = child.childCount > 1 ? child.child(1) : null
      if (group) visit(group, contentPos + content.nodeSize + 1, next)
    })
  }
  visit(doc, 0, { bullet: 0, number: 0 })
  return DecorationSet.create(doc, decorations)
}

export const listMarkers = createExtension({
  key: 'nbListMarkers',
  prosemirrorPlugins: [
    new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, state) => markers(state.doc),
        apply: (tr, set) => (tr.docChanged ? markers(tr.doc) : set)
      },
      props: { decorations: (state) => key.getState(state) }
    })
  ]
})
