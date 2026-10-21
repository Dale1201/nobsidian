import { useMemo } from 'react'
import { codeBlockOptions } from '@blocknote/code-block'
import { decodeHref } from '@shared/core/paths'
import type { PageDoc } from '@shared/types'
import { Editor } from '../editor/Editor'
import { createLanguageResolver, withEditorLanguages } from '../editor/codeLanguages'
import type { AppPartialBlock } from '../editor/schema'
import { resolveAssetUrl } from '../lib/assets'
import { openHref } from '../lib/navigation'
import { usePageLink } from '../lib/pageLink'
import { PageIconView } from './PageIconView'

const editorLanguage = createLanguageResolver(codeBlockOptions.supportedLanguages)

// Links to pages that are not in the workspace (deleted sub-pages) have nowhere to go.
const openLink = (href: string): void => {
  if (!/\.md$/i.test(decodeHref(href))) openHref(href)
}

/** A page shown as it is (a trashed page or an old version); nothing on it can be edited. */
export function ReadOnlyPage({
  doc,
  theme
}: {
  doc: PageDoc
  theme: 'light' | 'dark'
}): React.JSX.Element {
  const pageLink = usePageLink()
  const blocks = useMemo(
    () => withEditorLanguages(doc.blocks, editorLanguage) as unknown as AppPartialBlock[],
    [doc.blocks]
  )
  const width = doc.meta.fullWidth ? 'full-width' : ''
  return (
    <div className="read-only-page">
      {doc.meta.cover && (
        <div className="page-cover">
          <img
            src={resolveAssetUrl(doc.meta.cover)}
            alt=""
            draggable={false}
            style={{ objectPosition: `center ${doc.meta.coverPosition ?? 50}%` }}
          />
        </div>
      )}
      <div className={`page-column ${width}`}>
        <div className={`page-header ${doc.meta.cover ? 'has-cover' : ''}`}>
          {doc.meta.icon && (
            <div className="page-header-icon static">
              <PageIconView icon={doc.meta.icon} size={78} />
            </div>
          )}
          {/* Keeps the gap the editable page's hover controls take. */}
          <div className="page-header-controls" aria-hidden />
          <h1 className="page-title static">{doc.title || 'Untitled'}</h1>
        </div>
      </div>
      <div className={`page-column page-body ${width}`}>
        <Editor
          initialBlocks={blocks}
          theme={theme}
          editable={false}
          onChange={() => {}}
          uploadFile={async () => ''}
          resolveFileUrl={async (url) => resolveAssetUrl(url)}
          createSubPage={async () => ''}
          openLink={openLink}
          pageLink={{ ...pageLink, open: openLink }}
        />
      </div>
    </div>
  )
}
