import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import 'katex/dist/katex.min.css'
import './editor.css'

import { en } from '@blocknote/core/locales'
import { syntaxHighlighter } from '@blocknote/code-block'
import { BlockNoteView } from '@blocknote/mantine'
import {
  DeleteLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  LinkToolbar,
  LinkToolbarController,
  SuggestionMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useDictionary,
  useEditorDOMElement,
  type LinkToolbarProps
} from '@blocknote/react'
import { locales as multiColumnLocales, multiColumnDropCursor } from '@blocknote/xl-multi-column'
import { createContext, useContext, useEffect } from 'react'
import type { Block } from '@shared/core/blocks'
import { errorReason, useApp } from '../store'
import { readNotionClipboard, type NotionClipboard } from '@shared/notion/paste'
import { ATTACH_FILES_EVENT, insertAtCursor, insertPlainText } from './attachFiles'
import { AppColorStyleButton } from './ColorButton'
import { ColorPickContext, type PickedColor } from './colors'
import { AppCreateLinkButton, AppEditLinkButton } from './LinkButtons'
import { isValidLink, linkHrefFromEvent } from './links'
import {
  PageLinkContext,
  schema,
  type AppSchema,
  type AppBlock,
  type AppPartialBlock,
  type PageLinkContextValue
} from './schema'
import { querySlashItems } from './slashItems'

export type EditorProps = {
  initialBlocks: AppPartialBlock[]
  theme: 'light' | 'dark'
  onChange(blocks: AppBlock[]): void
  uploadFile(file: File): Promise<string>
  resolveFileUrl(url: string): Promise<string>
  createSubPage(): Promise<string>
  openLink(href: string): void
  pageLink: PageLinkContextValue
  editable?: boolean
  /** Applied by Cmd+Shift+H. */
  lastColor?: PickedColor
  onPickColor?(picked: PickedColor): void
  /** Blocks for content copied from Notion; other pastes use the editor's own handling. */
  pasteNotion?(clipboard: NotionClipboard): Promise<Block[]>
}

const DEFAULT_COLOR: PickedColor = { kind: 'background', color: 'yellow' }

const OpenLinkContext = createContext<(href: string) => void>(() => {})

// Default items minus text alignment, with link creation that doesn't rewrite hrefs.
function AppFormattingToolbar(): React.JSX.Element {
  return (
    <FormattingToolbar>
      {getFormattingToolbarItems()
        .filter((item) => !String(item.key).startsWith('textAlign'))
        .map((item) =>
          item.key === 'createLinkButton' ? (
            <AppCreateLinkButton key="createLinkButton" />
          ) : item.key === 'colorStyleButton' ? (
            <AppColorStyleButton key="colorStyleButton" />
          ) : (
            item
          )
        )}
    </FormattingToolbar>
  )
}

// The default "Open" button calls window.open on the URL resolved against the page URL,
// and the default edit form prefixes https:// to hrefs outside a fixed protocol list.
function AppLinkToolbar(props: LinkToolbarProps): React.JSX.Element {
  const Components = useComponentsContext()!
  const dict = useDictionary()
  const openLink = useContext(OpenLinkContext)
  return (
    <LinkToolbar {...props}>
      <AppEditLinkButton
        url={props.url}
        text={props.text}
        range={props.range}
        setToolbarOpen={props.setToolbarOpen}
        setToolbarPositionFrozen={props.setToolbarPositionFrozen}
      />
      <Components.LinkToolbar.Button
        className="bn-button"
        mainTooltip={dict.link_toolbar.open.tooltip}
        label={dict.link_toolbar.open.tooltip}
        isSelected={false}
        onClick={() => openLink(props.url)}
        icon={<span aria-hidden>↗</span>}
      />
      <DeleteLinkButton range={props.range} setToolbarOpen={props.setToolbarOpen} />
    </LinkToolbar>
  )
}

/** Cmd+Shift+H toggles the last color picked in the toolbar on the selection, like Notion. */
function HighlightShortcut({ color }: { color: PickedColor }): null {
  const editor = useBlockNoteEditor<
    AppSchema['blockSchema'],
    AppSchema['inlineContentSchema'],
    AppSchema['styleSchema']
  >()
  const dom = useEditorDOMElement()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!editor.isEditable || event.key.toLowerCase() !== 'h') return
      if (!event.metaKey || !event.shiftKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      if (event.repeat) return
      const style =
        color.kind === 'text' ? { textColor: color.color } : { backgroundColor: color.color }
      const active = editor.getActiveStyles()
      const current = color.kind === 'text' ? active.textColor : active.backgroundColor
      if (current === color.color) editor.removeStyles(style)
      else editor.addStyles(style)
    }
    dom?.addEventListener('keydown', onKeyDown)
    return () => dom?.removeEventListener('keydown', onKeyDown)
  }, [editor, dom, color])
  return null
}

// Mount with `key={pageId}`: the editor is created once from initialBlocks.
export function Editor(props: EditorProps): React.JSX.Element {
  const editor = useCreateBlockNote({
    schema,
    initialContent: props.initialBlocks.length ? props.initialBlocks : undefined,
    dictionary: { ...en, multi_column: multiColumnLocales.en },
    dropCursor: multiColumnDropCursor,
    extensions: [syntaxHighlighter],
    uploadFile: (file) => props.uploadFile(file),
    resolveFileUrl: (url) => props.resolveFileUrl(url),
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      const notion = event.clipboardData && readNotionClipboard(event.clipboardData)
      if (!notion || !props.pasteNotion) return defaultPasteHandler()
      const text = event.clipboardData.getData('text/plain')
      const insert = (blocks: Block[]): void => {
        try {
          if (blocks.length > 0) insertAtCursor(editor, blocks)
          else insertPlainText(editor, text)
        } catch {
          // The editor changed under the paste; there is nowhere left to put it.
        }
      }
      props.pasteNotion(notion).then(insert, (err: unknown) => {
        insert([])
        useApp.getState().showMessage(`Couldn't paste from Notion: ${errorReason(err)}`)
      })
      return true
    },
    links: {
      isValidLink,
      onClick: (event) => {
        const href = linkHrefFromEvent(event)
        if (!href) return false
        event.preventDefault()
        props.openLink(href)
        return true
      }
    }
  })

  const { uploadFile, editable } = props
  useEffect(() => {
    if (editable === false) return
    const attach = (event: Event): void => {
      const files = (event as CustomEvent<File[]>).detail
      void Promise.all(
        files.map(async (file): Promise<Block> => ({
          type: 'file',
          props: { url: await uploadFile(file), name: file.name },
          children: []
        }))
      )
        .then((blocks) => insertAtCursor(editor, blocks))
        .catch((e) => useApp.getState().showMessage(`Couldn't attach the file: ${errorReason(e)}`))
    }
    window.addEventListener(ATTACH_FILES_EVENT, attach)
    return () => window.removeEventListener(ATTACH_FILES_EVENT, attach)
  }, [editor, uploadFile, editable])

  return (
    <PageLinkContext.Provider value={props.pageLink}>
      <OpenLinkContext.Provider value={props.openLink}>
        <ColorPickContext.Provider value={props.onPickColor ?? (() => {})}>
          <BlockNoteView
            editor={editor}
            theme={props.theme}
            editable={props.editable !== false}
            slashMenu={false}
            formattingToolbar={false}
            linkToolbar={false}
            onChange={(ed) => props.onChange(ed.document)}
          >
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={(query) =>
                querySlashItems(editor, { createSubPage: props.createSubPage }, query)
              }
            />
            <FormattingToolbarController formattingToolbar={AppFormattingToolbar} />
            <LinkToolbarController linkToolbar={AppLinkToolbar} />
            <HighlightShortcut color={props.lastColor ?? DEFAULT_COLOR} />
          </BlockNoteView>
        </ColorPickContext.Provider>
      </OpenLinkContext.Provider>
    </PageLinkContext.Provider>
  )
}
