import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Root, RootContent, PhrasingContent } from 'mdast'

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkStringify, {
  bullet: '-',
  emphasis: '*',
  strong: '*',
  fences: true,
  rule: '-',
  listItemIndent: 'one',
  incrementListMarker: true
})

export function parseMarkdown(markdown: string): Root {
  return processor.runSync(processor.parse(markdown)) as Root
}

export function stringifyMarkdown(children: RootContent[]): string {
  return processor.stringify({ type: 'root', children })
}

export function stringifyPhrasing(children: PhrasingContent[]): string {
  return stringifyMarkdown([{ type: 'paragraph', children }]).replace(/\n$/, '')
}
