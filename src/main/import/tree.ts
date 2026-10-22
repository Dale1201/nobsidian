// Notion's export names pages `Title <32 hex>.html` and their child folders `Title/`, without
// the id, so siblings with the same title share a folder. Parents are found through the links
// each page has to its sub-pages, and folders only decide where those links are allowed to point.

const PAGE_FILE = /^(.*) ([0-9a-f]{32})\.html$/

export interface ExportPage {
  notionId: string
  path: string
  /** The folder its sub-pages live in. */
  folder: string
}

export function exportPages(paths: Iterable<string>): ExportPage[] {
  const pages: ExportPage[] = []
  for (const path of paths) {
    const slash = path.lastIndexOf('/')
    const dir = slash === -1 ? '' : path.slice(0, slash)
    const m = PAGE_FILE.exec(path.slice(slash + 1))
    if (!m) continue
    pages.push({ notionId: m[2], path, folder: dir ? `${dir}/${m[1]}` : m[1] })
  }
  return pages
}

export function dirOfPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export interface TreeNode {
  notionId: string
  /** Null for a top-level page of the export. */
  parent: string | null
  /** The export folder a top-level page sits in, such as `Private & Shared`. */
  group: string
}

/**
 * Each page's parent and its children's order, from the sub-page links (`links`, in order of
 * appearance) every page contains.
 */
export function buildTree(
  pages: ExportPage[],
  links: Map<string, string[]>
): { nodes: Map<string, TreeNode>; order: Map<string | null, string[]> } {
  const byFolder = new Map<string, ExportPage[]>()
  for (const p of pages) {
    const list = byFolder.get(p.folder)
    if (list) list.push(p)
    else byFolder.set(p.folder, [p])
  }
  const byId = new Map(pages.map((p) => [p.notionId, p]))
  const nodes = new Map<string, TreeNode>()
  const order = new Map<string | null, string[]>()
  const push = (parent: string | null, id: string): void => {
    const list = order.get(parent)
    if (list) list.push(id)
    else order.set(parent, [id])
  }
  // Linked sub-pages first, in the order their parent shows them.
  for (const p of pages) {
    for (const childId of links.get(p.notionId) ?? []) {
      const child = byId.get(childId)
      if (!child || nodes.has(childId) || childId === p.notionId) continue
      if (dirOfPath(child.path) !== p.folder) continue
      nodes.set(childId, { notionId: childId, parent: p.notionId, group: '' })
      push(p.notionId, childId)
    }
  }
  // Pages nothing links to: their folder's page, else the top level.
  const rest = pages
    .filter((p) => !nodes.has(p.notionId))
    .sort((a, b) => a.path.localeCompare(b.path))
  for (const p of rest) {
    const dir = dirOfPath(p.path)
    const owner = pages.find((o) => o.folder === dir && o.notionId !== p.notionId)
    if (owner) {
      nodes.set(p.notionId, { notionId: p.notionId, parent: owner.notionId, group: '' })
      push(owner.notionId, p.notionId)
    } else {
      nodes.set(p.notionId, { notionId: p.notionId, parent: null, group: dir })
      push(null, p.notionId)
    }
  }
  return { nodes, order }
}
