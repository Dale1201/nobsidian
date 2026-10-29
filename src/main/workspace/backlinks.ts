import type { Block } from '../../shared/core/blocks'
import { parsePage } from '../../shared/core/page'
import { pageLinkTargets } from '../../shared/core/pageLinks'
import { isExternalHref, resolveHref } from '../../shared/core/paths'

interface Entry {
  text: string
  /** Workspace paths of linked pages, mapped to whether every link is a page link block. */
  targets: Map<string, boolean>
}

/** The pages each page file links to, cached against the exact text it was read from. */
export class LinkGraph {
  private entries = new Map<string, Entry>()

  /** Records links from blocks already parsed out of `text`. */
  note(path: string, text: string, fileBlocks: Block[]): void {
    this.entries.set(path, { text, targets: resolveTargets(path, fileBlocks) })
  }

  /** Links in the page file at `path`, whose current text is `text`. */
  targetsOf(path: string, text: string): Map<string, boolean> {
    const cached = this.entries.get(path)
    if (cached?.text === text) return cached.targets
    // Page links on disk are relative paths to .md files.
    const blocks = /\.md\b/i.test(text) ? parsePage(text).blocks : []
    this.note(path, text, blocks)
    return this.entries.get(path)!.targets
  }
}

function resolveTargets(path: string, blocks: Block[]): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const [href, onlyBlocks] of pageLinkTargets(blocks)) {
    if (isExternalHref(href)) continue
    const target = resolveHref(path, href)
    if (!/\.md$/i.test(target)) continue
    out.set(target, (out.get(target) ?? true) && onlyBlocks)
  }
  return out
}
