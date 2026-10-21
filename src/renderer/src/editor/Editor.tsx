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
  useComponentsContext,
  useCreateBlockNote,
  useDictionary,
  type LinkToolbarProps
} from '@blocknote/react'
import { locales as multiColumnLocales, multiColumnDropCursor } from '@blocknote/xl-multi-column'
import { createContext, useContext } from 'react'
import { AppCreateLinkButton, AppEditLinkButton } from './LinkButtons'
import { isValidLink, linkHrefFromEvent } from './links'
import {
  PageLinkContext,
  schema,
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
}

const OpenLinkContext = createContext<(href: string) => void>(() => {})

// Default items minus text alignment, with link creation that doesn't rewrite hrefs.
function AppFormattingToolbar(): React.JSX.Element {
  return (
    <FormattingToolbar>
      {getFormattingToolbarItems()
        .filter((item) => !String(item.key).startsWith('textAlign'))
        .map((item) =>
          item.key === 'createLinkButton' ? <AppCreateLinkButton key="createLinkButton" /> : item
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

  return (
    <PageLinkContext.Provider value={props.pageLink}>
      <OpenLinkContext.Provider value={props.openLink}>
        <BlockNoteView
          editor={editor}
          theme={props.theme}
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
        </BlockNoteView>
      </OpenLinkContext.Provider>
    </PageLinkContext.Provider>
  )
}
