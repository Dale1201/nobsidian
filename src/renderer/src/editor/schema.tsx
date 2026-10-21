import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultProps,
  type Block,
  type PartialBlock
} from '@blocknote/core'
import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react'
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
      raw: createRaw()
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
