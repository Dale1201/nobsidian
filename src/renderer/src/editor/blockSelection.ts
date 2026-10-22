import { createExtension } from '@blocknote/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { AppEditor } from './schema'

const key = new PluginKey<string[]>('nbBlockSelection')

export function selectedBlockIds(editor: AppEditor): string[] {
  return key.getState(editor.prosemirrorState) ?? []
}

export function selectBlocks(editor: AppEditor, ids: string[]): void {
  const view = editor.prosemirrorView
  view.dispatch(view.state.tr.setMeta(key, ids))
}

export const blockSelection = createExtension({
  key: 'nbBlockSelection',
  prosemirrorPlugins: [
    new Plugin<string[]>({
      key,
      state: {
        init: () => [],
        apply: (tr, ids) => {
          const next = tr.getMeta(key) as string[] | undefined
          if (next) return next
          // Any edit or caret move ends a block selection, as in Notion.
          return ids.length && (tr.docChanged || tr.selectionSet) ? [] : ids
        }
      },
      props: {
        decorations: (state) => {
          const ids = new Set(key.getState(state))
          if (ids.size === 0) return null
          const decorations: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'blockContainer' || !ids.has(node.attrs.id)) return true
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, { class: 'nb-block-selected' })
            )
            return false
          })
          return DecorationSet.create(state.doc, decorations)
        },
        attributes: (state): Record<string, string> =>
          key.getState(state)?.length ? { class: 'nb-has-block-selection' } : {},
        handleDOMEvents: {
          mousedown: (view) => {
            if (key.getState(view.state)?.length) view.dispatch(view.state.tr.setMeta(key, []))
            return false
          }
        }
      }
    })
  ]
})
