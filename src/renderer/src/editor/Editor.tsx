import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import 'katex/dist/katex.min.css'
import './editor.css'

import { en } from '@blocknote/core/locales'
import { syntaxHighlighter } from '@blocknote/code-block'
import { BlockNoteView } from '@blocknote/mantine'
import {
  BasicTextStyleButton,
  DeleteLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  LinkToolbar,
  LinkToolbarController,
  SideMenuController,
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
import {
  ATTACH_FILES_EVENT,
  insertAtCursor,
  insertPasted,
  insertPlainText,
  pasteAsText
} from './attachFiles'
import { AppColorStyleButton } from './ColorButton'
import { ColorPickContext, type PickedColor } from './colors'
import { AppCreateLinkButton, AppEditLinkButton } from './LinkButtons'
import { isValidLink, linkHrefFromEvent } from './links'
import { blockSelection } from './blockSelection'
import { BlockSelectionKeys } from './BlockSelectionKeys'
import { listMarkers } from './listMarkersPlugin'
import { markdownShortcuts, tildeStrike } from './markdownShortcuts'
import { notionKeys } from './notionKeys'
import type { WebImage } from './notionPaste'
import {
  PageLinkContext,
  schema,
  type AppSchema,
  type AppBlock,
  type AppPartialBlock,
  type PageLinkContextValue
} from './schema'
import { AppSideMenu } from './menus/AppSideMenu'
import { PagePicker } from './menus/PagePicker'
import { BlockMenuHost } from './menus/BlockMenu'
import { SlashMenu } from './menus/SlashMenu'
import { TurnIntoButton } from './menus/TurnIntoButton'
import { querySlashItems, type SlashItem } from './slashItems'
import { usePickerItems } from './usePickerItems'

export type EditorProps = {
  initialBlocks: AppPartialBlock[]
  theme: 'light' | 'dark'
  onChange(blocks: AppBlock[]): void
  uploadFile(file: File): Promise<string>
  resolveFileUrl(url: string): Promise<string>
  createSubPage(): Promise<string>
  /** Creates a sub-page with this title for a mention, and returns its link. */
  createLinkedPage?(title: string): Promise<string>
  openLink(href: string): void
  pageLink: PageLinkContextValue
  editable?: boolean
  /** Applied by Cmd+Shift+H. */
  lastColor?: PickedColor
  onPickColor?(picked: PickedColor): void
  /**
   * Blocks for content copied from Notion, with web images to download into place after they
   * are inserted; other pastes use the editor's own handling.
   */
  pasteNotion?(clipboard: NotionClipboard): Promise<{ blocks: Block[]; images: WebImage[] }>
}

const DEFAULT_COLOR: PickedColor = { kind: 'background', color: 'yellow' }

const OpenLinkContext = createContext<(href: string) => void>(() => {})

// File buttons only show for file blocks; text alignment, nesting and the block type select are not Notion's.
const TOOLBAR_KEYS = [
  'tableCellMergeButton',
  'fileCaptionButton',
  'replaceFileButton',
  'fileRenameButton',
  'fileDeleteButton',
  'fileDownloadButton',
  'filePreviewButton'
]

function AppFormattingToolbar(): React.JSX.Element {
  const defaults = new Map(getFormattingToolbarItems().map((item) => [String(item.key), item]))
  return (
    <FormattingToolbar>
      <TurnIntoButton key="turnInto" />
      {TOOLBAR_KEYS.map((key) => defaults.get(key))}
      <AppCreateLinkButton key="createLinkButton" />
      <BasicTextStyleButton basicTextStyle="bold" key="bold" />
      <BasicTextStyleButton basicTextStyle="italic" key="italic" />
      <BasicTextStyleButton basicTextStyle="underline" key="underline" />
      <BasicTextStyleButton basicTextStyle="strike" key="strike" />
      <BasicTextStyleButton basicTextStyle="code" key="code" />
      <AppColorStyleButton key="colorStyleButton" />
    </FormattingToolbar>
  )
}

// Notion writes shortcuts as "⌘B"; BlockNote's "Mod+B" would show as "⌘+B".
const shortcut = (tip: string, keys: string): { tooltip: string; secondary_tooltip: string } => ({
  tooltip: tip,
  secondary_tooltip: keys
})

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
    dictionary: {
      ...en,
      multi_column: multiColumnLocales.en,
      toggle_blocks: {
        ...en.toggle_blocks,
        add_block_button: 'Empty toggle. Click or drop blocks inside.'
      },
      formatting_toolbar: {
        ...en.formatting_toolbar,
        bold: shortcut('Bold', 'ModB'),
        italic: shortcut('Italic', 'ModI'),
        underline: shortcut('Underline', 'ModU'),
        strike: shortcut('Strike', 'Mod⇧S'),
        code: shortcut('Code', 'ModE'),
        link: shortcut('Create link', 'ModK')
      }
    },
    dropCursor: multiColumnDropCursor,
    extensions: [
      syntaxHighlighter,
      listMarkers,
      blockSelection,
      markdownShortcuts,
      tildeStrike,
      notionKeys
    ],
    uploadFile: (file) => props.uploadFile(file),
    resolveFileUrl: (url) => props.resolveFileUrl(url),
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      const notion = event.clipboardData && readNotionClipboard(event.clipboardData)
      if (!notion || !props.pasteNotion) return defaultPasteHandler()
      const text = event.clipboardData.getData('text/plain')
      if (pasteAsText(editor, text)) return true
      // An editor whose page was left is unmounted, and edits to it are never saved.
      const closed = (): boolean => {
        if (!editor.headless) return false
        useApp
          .getState()
          .showMessage('The page was left before the paste from Notion finished. Paste it again.')
        return true
      }
      const insertText = (): void => {
        try {
          insertPlainText(editor, text)
        } catch {
          // The editor changed under the paste; there is nowhere left to put it.
        }
      }
      const fail = (err: unknown): void => {
        if (closed()) return
        insertText()
        useApp.getState().showMessage(`Couldn't paste from Notion: ${errorReason(err)}`)
      }
      props.pasteNotion(notion).then(({ blocks, images }) => {
        if (closed()) return
        if (blocks.length === 0) return insertText()
        try {
          insertPasted(editor, blocks)
        } catch (err) {
          return fail(err)
        }
        for (const image of images) {
          void image.download().then((update) => {
            if (editor.headless) return
            try {
              editor.updateBlock(image.id, update as unknown as AppPartialBlock)
            } catch {
              // The image was deleted while it downloaded.
            }
          })
        }
      }, fail)
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

  const pickerItems = usePickerItems(editor, props.createLinkedPage)

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
            sideMenu={false}
            onChange={(ed) => props.onChange(ed.document)}
          >
            <BlockMenuHost>
              {props.editable !== false && (
                <>
                  <SuggestionMenuController
                    triggerCharacter="@"
                    getItems={pickerItems}
                    suggestionMenuComponent={PagePicker}
                    onItemClick={(item) => item.onItemClick()}
                  />
                  <SuggestionMenuController
                    triggerCharacter="[["
                    getItems={pickerItems}
                    suggestionMenuComponent={PagePicker}
                    onItemClick={(item) => item.onItemClick()}
                  />
                </>
              )}
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={(query: string): Promise<SlashItem[]> =>
                  querySlashItems(editor, { createSubPage: props.createSubPage }, query)
                }
                suggestionMenuComponent={SlashMenu}
              />
              <SideMenuController sideMenu={AppSideMenu} />
              <FormattingToolbarController formattingToolbar={AppFormattingToolbar} />
              <LinkToolbarController linkToolbar={AppLinkToolbar} />
              <HighlightShortcut color={props.lastColor ?? DEFAULT_COLOR} />
              <BlockSelectionKeys />
            </BlockMenuHost>
          </BlockNoteView>
        </ColorPickContext.Provider>
      </OpenLinkContext.Provider>
    </PageLinkContext.Provider>
  )
}
