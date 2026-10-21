import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultProps,
  type Block,
  type PartialBlock
} from '@blocknote/core'
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
  useEditorChange
} from '@blocknote/react'
import { codeBlockOptions } from '@blocknote/code-block'
import { withMultiColumn } from '@blocknote/xl-multi-column'
import { createContext, useContext, useState } from 'react'
import { Katex } from './Katex'

export type PageLinkContextValue = {
  resolve(href: string): { title: string; icon?: string } | null
  open(href: string): void
}

export const PageLinkContext = createContext<PageLinkContextValue | null>(null)

export const createCallout = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: {
      textColor: defaultProps.textColor,
      backgroundColor: { default: 'gray' },
      icon: { default: '💡' }
    },
    content: 'inline'
  },
  {
    render: ({ block, contentRef }) => (
      // BlockNote paints backgroundColor/textColor on the enclosing .bn-block.
      <div className="nb-callout">
        <span className="nb-callout-icon" contentEditable={false}>
          {block.props.icon}
        </span>
        <div className="nb-callout-content" ref={contentRef} />
      </div>
    )
  }
)

export const createMath = createReactBlockSpec(
  {
    type: 'math',
    propSchema: { latex: { default: '' } },
    content: 'none'
  },
  {
    render: function MathBlock({ block, editor }) {
      const [editing, setEditing] = useState(false)
      if (editing) {
        return (
          <textarea
            className="nb-math-source"
            autoFocus
            defaultValue={block.props.latex}
            onBlur={(e) => {
              editor.updateBlock(block, {
                props: { latex: e.currentTarget.value }
              })
              setEditing(false)
            }}
          />
        )
      }
      return (
        <div className="nb-math" onClick={() => editor.isEditable && setEditing(true)}>
          {block.props.latex ? (
            <Katex latex={block.props.latex} displayMode />
          ) : (
            <span className="nb-math-empty">Add a TeX equation</span>
          )}
        </div>
      )
    }
  }
)

export const createPageLink = createReactBlockSpec(
  {
    type: 'pageLink',
    propSchema: { href: { default: '' } },
    content: 'none'
  },
  {
    render: function PageLinkBlock({ block }) {
      const ctx = useContext(PageLinkContext)
      const target = ctx?.resolve(block.props.href)
      return (
        <div
          className="nb-page-link"
          data-missing={target ? undefined : 'true'}
          onClick={() => ctx?.open(block.props.href)}
        >
          <span className="nb-page-link-icon">{target?.icon ?? '📄'}</span>
          <span className="nb-page-link-title">{target?.title ?? block.props.href}</span>
        </div>
      )
    }
  }
)

interface TocEntry {
  id: string
  level: number
  text: string
}

// Structural, so the block spec does not depend on the schema type it is part of.
interface OutlineBlock {
  id: string
  type: string
  props: { level?: number }
  content?: unknown
  children: OutlineBlock[]
}

type OutlineInline = { type: string; text?: string; content?: { text: string }[] }

function tocEntries(blocks: OutlineBlock[], out: TocEntry[] = []): TocEntry[] {
  for (const block of blocks) {
    if (block.type === 'heading' && Array.isArray(block.content)) {
      const text = (block.content as OutlineInline[])
        .map((c) => c.text ?? c.content?.map((t) => t.text).join('') ?? '')
        .join('')
      out.push({ id: block.id, level: block.props.level ?? 1, text })
    }
    tocEntries(block.children, out)
  }
  return out
}

function sameEntries(a: TocEntry[], b: TocEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((e, i) => e.id === b[i].id && e.text === b[i].text && e.level === b[i].level)
  )
}

/** A heading in a collapsed toggle has no box, so scroll to the nearest ancestor that does. */
function scrollToBlock(root: HTMLElement | undefined, id: string): void {
  let el = root?.querySelector<HTMLElement>(`[data-id="${id}"]`) ?? null
  while (el && el.getClientRects().length === 0) {
    el = el.parentElement?.closest<HTMLElement>('.bn-block-outer') ?? null
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  el?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
}

export const createToc = createReactBlockSpec(
  {
    type: 'toc',
    propSchema: {},
    content: 'none'
  },
  {
    render: function TocBlock({ editor }) {
      const [entries, setEntries] = useState(() => tocEntries(editor.document as OutlineBlock[]))
      useEditorChange(() => {
        const next = tocEntries(editor.document as OutlineBlock[])
        setEntries((prev) => (sameEntries(prev, next) ? prev : next))
      }, editor)
      if (entries.length === 0) {
        return <div className="nb-toc-empty">Add headings to create a table of contents.</div>
      }
      const top = Math.min(...entries.map((e) => e.level))
      return (
        <nav className="nb-toc">
          {entries.map((entry) => (
            <button
              key={entry.id}
              className="nb-toc-item"
              style={{ paddingLeft: 6 + (entry.level - top) * 24 }}
              onClick={() => scrollToBlock(editor.domElement, entry.id)}
            >
              <span className="nb-toc-text">{entry.text || 'Untitled'}</span>
            </button>
          ))}
        </nav>
      )
    }
  }
)

export const createRaw = createReactBlockSpec(
  {
    type: 'raw',
    propSchema: { markdown: { default: '' } },
    content: 'none'
  },
  {
    render: ({ block }) => <pre className="nb-raw">{block.props.markdown}</pre>
  }
)

export const InlineMath = createReactInlineContentSpec(
  {
    type: 'inlineMath',
    propSchema: { latex: { default: '' } },
    content: 'none'
  },
  {
    render: ({ inlineContent }) => (
      <span className="nb-inline-math">
        <Katex latex={inlineContent.props.latex} displayMode={false} />
      </span>
    )
  }
)

export const schema = withMultiColumn(
  BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      codeBlock: createCodeBlockSpec(codeBlockOptions),
      callout: createCallout(),
      math: createMath(),
      pageLink: createPageLink(),
      raw: createRaw(),
      toc: createToc()
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      inlineMath: InlineMath
    }
  })
)

export type AppSchema = typeof schema
export type AppEditor = AppSchema['BlockNoteEditor']
export type AppBlock = Block<
  AppSchema['blockSchema'],
  AppSchema['inlineContentSchema'],
  AppSchema['styleSchema']
>
export type AppPartialBlock = PartialBlock<
  AppSchema['blockSchema'],
  AppSchema['inlineContentSchema'],
  AppSchema['styleSchema']
>
