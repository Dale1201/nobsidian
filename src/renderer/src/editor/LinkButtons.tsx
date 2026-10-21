import { formatKeyboardShortcut, isTableCellSelection } from '@blocknote/core'
import { FormattingToolbarExtension, ShowSelectionExtension } from '@blocknote/core/extensions'
import {
  ScreenReaderOnlySubmit,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorDOMElement,
  useEditorState,
  useExtension,
  usePortalElement,
  type LinkToolbarProps
} from '@blocknote/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeLinkInput } from './links'
import type { AppSchema } from './schema'

const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

export function LinkIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  )
}

function TextIcon(): React.JSX.Element {
  return (
    <svg {...iconProps}>
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </svg>
  )
}

function LinkForm(props: {
  url: string
  text?: string
  onSubmit(url: string, text: string): void
}): React.JSX.Element {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  // Callers key the form by url and text, so fresh values remount it instead of syncing state.
  const [url, setUrl] = useState(props.url)
  const [text, setText] = useState(props.text ?? '')

  return (
    <Components.Generic.Form.Root
      onSubmit={() => props.onSubmit(normalizeLinkInput(url), text)}
      submitButton={<ScreenReaderOnlySubmit />}
    >
      <Components.Generic.Form.TextInput
        className="bn-text-input"
        name="url"
        icon={<LinkIcon />}
        autoFocus
        placeholder={dict.link_toolbar.form.url_placeholder}
        value={url}
        onChange={(e) => setUrl(e.currentTarget.value)}
      />
      {props.text !== undefined && (
        <Components.Generic.Form.TextInput
          className="bn-text-input"
          name="title"
          icon={<TextIcon />}
          placeholder={dict.link_toolbar.form.title_placeholder}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      )}
    </Components.Generic.Form.Root>
  )
}

// Same visibility rules, Mod+K shortcut and selection highlight as BlockNote's CreateLinkButton.
export function AppCreateLinkButton(): React.JSX.Element | null {
  const editor = useBlockNoteEditor<
    AppSchema['blockSchema'],
    AppSchema['inlineContentSchema'],
    AppSchema['styleSchema']
  >()
  const editorDOMElement = useEditorDOMElement()
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const portalElement = usePortalElement()
  const formattingToolbar = useExtension(FormattingToolbarExtension)
  const { showSelection } = useExtension(ShowSelectionExtension)
  // The popover belongs to one selection: moving the selection closes it.
  const [openFor, setOpenFor] = useState<string | null>(null)
  const selectionKey = useRef('')

  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const selection = editor.prosemirrorState.selection
      const hasInlineContent = (
        editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
      ).some((block) => block.content !== undefined)
      if (
        !editor.isEditable ||
        selection.empty ||
        !('link' in editor.schema.inlineContentSchema) ||
        isTableCellSelection(selection) ||
        !hasInlineContent
      ) {
        return undefined
      }
      return { url: editor.getSelectedLinkUrl() ?? '', from: selection.from, to: selection.to }
    }
  })
  const key = state ? `${state.from}:${state.to}` : ''
  useEffect(() => {
    selectionKey.current = key
  }, [key])
  const open = openFor !== null && openFor === key

  useEffect(() => {
    showSelection(open, 'appCreateLinkButton')
    return () => showSelection(false, 'appCreateLinkButton')
  }, [open, showSelection])

  const setPopoverOpen = useCallback(
    (next: boolean) => {
      if (!next) editor.focus()
      setOpenFor(next ? selectionKey.current : null)
    },
    [editor]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!editor.isEditable) return
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        setOpenFor(selectionKey.current)
        event.preventDefault()
      }
    }
    editorDOMElement?.addEventListener('keydown', onKeyDown)
    return () => editorDOMElement?.removeEventListener('keydown', onKeyDown)
  }, [editor, editorDOMElement])

  if (state === undefined) return null

  return (
    <Components.Generic.Popover.Root
      open={open}
      onOpenChange={setPopoverOpen}
      portalElement={portalElement}
    >
      <Components.Generic.Popover.Trigger>
        <Components.FormattingToolbar.Button
          className="bn-button"
          data-test="createLink"
          label={dict.formatting_toolbar.link.tooltip}
          mainTooltip={dict.formatting_toolbar.link.tooltip}
          secondaryTooltip={formatKeyboardShortcut(
            dict.formatting_toolbar.link.secondary_tooltip,
            dict.generic.ctrl_shortcut
          )}
          icon={<LinkIcon />}
          onClick={() => setPopoverOpen(!open)}
        />
      </Components.Generic.Popover.Trigger>
      <Components.Generic.Popover.Content
        className="bn-popover-content bn-form-popover"
        variant="form-popover"
      >
        <LinkForm
          key={state.url}
          url={state.url}
          onSubmit={(url) => {
            if (url === '') return
            editor.createLink(url)
            formattingToolbar.store.setState(false)
          }}
        />
      </Components.Generic.Popover.Content>
    </Components.Generic.Popover.Root>
  )
}

export function AppEditLinkButton(
  props: Pick<
    LinkToolbarProps,
    'url' | 'text' | 'range' | 'setToolbarOpen' | 'setToolbarPositionFrozen'
  >
): React.JSX.Element {
  const editor = useBlockNoteEditor<
    AppSchema['blockSchema'],
    AppSchema['inlineContentSchema'],
    AppSchema['styleSchema']
  >()
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const portalElement = usePortalElement()

  return (
    <Components.Generic.Popover.Root
      onOpenChange={props.setToolbarPositionFrozen}
      portalElement={portalElement}
    >
      <Components.Generic.Popover.Trigger>
        <Components.LinkToolbar.Button
          className="bn-button"
          mainTooltip={dict.link_toolbar.edit.tooltip}
          isSelected={false}
        >
          {dict.link_toolbar.edit.text}
        </Components.LinkToolbar.Button>
      </Components.Generic.Popover.Trigger>
      <Components.Generic.Popover.Content
        className="bn-popover-content bn-form-popover"
        variant="form-popover"
      >
        <LinkForm
          key={`${props.url}\n${props.text}`}
          url={props.url}
          text={props.text}
          onSubmit={(url, text) => {
            if (url === '') {
              editor.deleteLink(props.range.from)
            } else {
              editor.editLink(url, text || props.text, props.range.from)
            }
            props.setToolbarOpen?.(false)
            props.setToolbarPositionFrozen?.(false)
          }}
        />
      </Components.Generic.Popover.Content>
    </Components.Generic.Popover.Root>
  )
}
