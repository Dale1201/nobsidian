import {
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorState,
  usePortalElement
} from '@blocknote/react'
import { useContext } from 'react'
import { ColorPickContext, type ColorKind } from './colors'
import type { AppSchema } from './schema'

const COLORS = [
  'default',
  'gray',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink'
] as const

function ColorIcon({
  text,
  background,
  size = 16
}: {
  text?: string
  background?: string
  size?: number
}): React.JSX.Element {
  return (
    <div
      className="bn-color-icon"
      data-text-color={text ?? 'default'}
      data-background-color={background ?? 'default'}
      style={{
        pointerEvents: 'none',
        fontSize: Math.round(size * 0.75),
        height: size,
        lineHeight: `${size}px`,
        width: size,
        textAlign: 'center'
      }}
    >
      A
    </div>
  )
}

// BlockNote's ColorStyleButton, reporting the picked color.
export function AppColorStyleButton(): React.JSX.Element | null {
  const editor = useBlockNoteEditor<
    AppSchema['blockSchema'],
    AppSchema['inlineContentSchema'],
    AppSchema['styleSchema']
  >()
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const portalElement = usePortalElement()
  const onPick = useContext(ColorPickContext)

  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
      if (!editor.isEditable || !blocks.some((block) => block.content !== undefined))
        return undefined
      const styles = editor.getActiveStyles()
      return {
        text: (styles.textColor as string | undefined) ?? 'default',
        background: (styles.backgroundColor as string | undefined) ?? 'default'
      }
    }
  })

  if (state === undefined) return null

  const apply = (kind: ColorKind, color: string): void => {
    const style = kind === 'text' ? { textColor: color } : { backgroundColor: color }
    if (color === 'default') editor.removeStyles(style)
    else {
      editor.addStyles(style)
      onPick({ kind, color })
    }
    editor.focus()
  }

  const section = (kind: ColorKind): React.JSX.Element[] =>
    COLORS.map((color) => (
      <Components.Generic.Menu.Item
        key={`${kind}-${color}`}
        data-test={`${kind}-color-${color}`}
        icon={<ColorIcon {...(kind === 'text' ? { text: color } : { background: color })} />}
        checked={state[kind] === color}
        onClick={() => apply(kind, color)}
      >
        {dict.color_picker.colors[color]}
      </Components.Generic.Menu.Item>
    ))

  return (
    <Components.Generic.Menu.Root portalElement={portalElement}>
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button
          className="bn-button"
          data-test="colors"
          label={dict.formatting_toolbar.colors.tooltip}
          mainTooltip={dict.formatting_toolbar.colors.tooltip}
          icon={<ColorIcon size={20} text={state.text} background={state.background} />}
        />
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown bn-color-picker-dropdown">
        <Components.Generic.Menu.Label>
          {dict.color_picker.text_title}
        </Components.Generic.Menu.Label>
        {section('text')}
        <Components.Generic.Menu.Label>
          {dict.color_picker.background_title}
        </Components.Generic.Menu.Label>
        {section('background')}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}
