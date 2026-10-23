import { createExtension } from '@blocknote/core'
import { codeBlockOptions } from '@blocknote/code-block'
import { Extension, markInputRule } from '@tiptap/core'
import { Plugin } from 'prosemirror-state'

/** Notion's `"` quote, without BlockNote's `>` quote, which Notion uses for toggles. */
export const quoteShortcut = createExtension({
  key: 'nb-quote-shortcut',
  inputRules: [{ find: /^\p{Quotation_Mark}\s$/u, replace: () => ({ type: 'quote', props: {} }) }]
})

/** Headings 1-3 only, as in Notion; deeper headings from files still open. */
export const headingShortcuts = createExtension({
  key: 'nb-heading-shortcuts',
  inputRules: [1, 2, 3].map((level) => ({
    find: new RegExp(`^#{${level}}\\s$`),
    replace: () => ({ type: 'heading', props: { level, isToggleable: false } })
  }))
})

export const markdownShortcuts = createExtension({
  key: 'nb-markdown-shortcuts',
  inputRules: [
    { find: /^>\s$/, replace: () => ({ type: 'toggleListItem', props: {} }) },
    {
      find: /^```$/,
      replace: () => ({
        type: 'codeBlock',
        props: { language: codeBlockOptions.defaultLanguage ?? 'text' }
      })
    }
  ]
})

/** Notion strikes through `~text~`; tiptap only knows `~~text~~`. */
const singleTildeStrike = Extension.create({
  name: 'nbSingleTildeStrike',
  addInputRules() {
    const strike = this.editor.schema.marks.strike
    return strike ? [markInputRule({ find: /(?:^|\s)(~(?!~)([^~]+)~)$/, type: strike })] : []
  }
})

export const tildeStrike = createExtension({
  key: 'nb-tilde-strike',
  tiptapExtensions: [singleTildeStrike]
})

/**
 * `---` makes a divider and carries on typing in a new line below, as in Notion. BlockNote's own
 * rule leaves the divider selected, which swallows whatever is typed next.
 */
export const dividerShortcut = createExtension(({ editor }) => ({
  key: 'nb-divider-shortcut',
  prosemirrorPlugins: [
    new Plugin({
      props: {
        handleTextInput: (view, from, to, text) => {
          if (text !== '-' || from !== to) return false
          const { block } = editor.getTextCursorPosition()
          if (block.type !== 'paragraph' || !Array.isArray(block.content)) return false
          const typed = block.content.map((c) => ('text' in c ? c.text : '\u0000')).join('')
          const atEnd = view.state.selection.$from.parentOffset === typed.length
          if (typed !== '--' || !atEnd) return false
          editor.transact(() => {
            editor.updateBlock(block, { type: 'divider', props: {}, content: undefined })
            const [next] = editor.insertBlocks([{ type: 'paragraph' }], block.id, 'after')
            editor.setTextCursorPosition(next, 'start')
          })
          return true
        }
      }
    })
  ]
}))
