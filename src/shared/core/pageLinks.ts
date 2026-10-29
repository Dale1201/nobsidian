import type { Block } from './blocks'
import { mapBlockLinks } from './links'

/** Every link target in `blocks`, mapped to whether it only appears as page link blocks. */
export function pageLinkTargets(blocks: Block[]): Map<string, boolean> {
  const all = new Map<string, number>()
  mapBlockLinks(blocks, (href) => {
    all.set(href, (all.get(href) ?? 0) + 1)
    return href
  })
  const asBlocks = new Map<string, number>()
  const walk = (list: Block[]): void => {
    for (const block of list) {
      if (block.type === 'pageLink')
        asBlocks.set(block.props.href, (asBlocks.get(block.props.href) ?? 0) + 1)
      walk(block.children)
    }
  }
  walk(blocks)
  return new Map([...all].map(([href, n]) => [href, asBlocks.get(href) === n]))
}
