import type { Block } from '@shared/core/blocks'

type Supported = Record<string, { name: string; aliases?: string[] }>

/**
 * The highlighter only accepts its own language ids ("typescript", not "ts") and
 * crashes on anything else, so fence languages are mapped before loading.
 */
export function createLanguageResolver(supported: Supported): (lang: string) => string {
  const byAlias = new Map<string, string>()
  for (const [id, lang] of Object.entries(supported)) {
    byAlias.set(id.toLowerCase(), id)
    for (const alias of lang.aliases ?? []) byAlias.set(alias.toLowerCase(), id)
  }
  return (lang) => byAlias.get(lang.toLowerCase()) ?? 'text'
}

export function withEditorLanguages(blocks: Block[], resolve: (lang: string) => string): Block[] {
  return blocks.map((block) => {
    const children = withEditorLanguages(block.children, resolve)
    if (block.type === 'codeBlock') {
      return {
        ...block,
        props: { ...block.props, language: resolve(block.props.language) },
        children
      }
    }
    return { ...block, children } as Block
  })
}
