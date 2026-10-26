import { useComponentsContext, useEditorDOMElement } from '@blocknote/react'
import { useEffect } from 'react'
import { SparkleIcon } from '../components/icons'
import { useAppEditor } from '../editor/useAppEditor'
import { setAiAvailable } from './pending'
import { useAiAccess } from './useAiAccess'
import { isPlainSpace, opensOnSpace } from './writerModel'
import { openWriter } from './writerRegistry'

export function AskAiButton(): React.JSX.Element | null {
  const Components = useComponentsContext()!
  const editor = useAppEditor()
  const { shown, online } = useAiAccess()
  if (!shown) return null
  return (
    <Components.FormattingToolbar.Button
      className="bn-button nb-ask-ai-button"
      label="Ask AI"
      mainTooltip={
        online ? 'Ask AI to help edit, review, or generate text.' : 'AI is unavailable offline'
      }
      secondaryTooltip={online ? '⌘J' : undefined}
      isDisabled={!online}
      onClick={() => openWriter(editor)}
    >
      <SparkleIcon size={16} />
      Ask AI
    </Components.FormattingToolbar.Button>
  )
}

/** Cmd+J anywhere in the page, Space on an empty line, and the empty-line hint. */
export function WriterKeys(): null {
  const editor = useAppEditor()
  const dom = useEditorDOMElement()
  const { shown, online, ready } = useAiAccess()
  // Only once the editor is mounted: its plugins do not exist before.
  useEffect(() => {
    if (dom) setAiAvailable(editor, ready)
  }, [editor, dom, ready])
  useEffect(() => {
    if (!shown) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!editor.isEditable) return
      if (event.key.toLowerCase() === 'j' && event.metaKey && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        if (online) openWriter(editor)
        return
      }
      if (!ready || !isPlainSpace(event)) return
      const { selection } = editor.prosemirrorState
      const parent = selection.$from.parent
      const block = editor.getTextCursorPosition().block
      const line = {
        type: block.type,
        empty: parent.content.size === 0,
        selectionEmpty: selection.empty
      }
      if (!opensOnSpace(event, line)) return
      event.preventDefault()
      openWriter(editor)
    }
    // Capture, so Space is taken before the editor types it.
    dom?.addEventListener('keydown', onKeyDown, true)
    return () => dom?.removeEventListener('keydown', onKeyDown, true)
  }, [editor, dom, shown, online, ready])
  return null
}
