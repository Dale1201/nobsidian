import type { PageNode } from '@shared/types'

export function findNode(nodes: PageNode[], id: string): PageNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return null
}

/** Nodes from the root down to (and including) `id`. */
export function pathTo(nodes: PageNode[], id: string): PageNode[] {
  for (const node of nodes) {
    if (node.id === id) return [node]
    const rest = pathTo(node.children, id)
    if (rest.length) return [node, ...rest]
  }
  return []
}

export function parentOf(nodes: PageNode[], id: string): PageNode | null {
  const path = pathTo(nodes, id)
  return path.length > 1 ? path[path.length - 2] : null
}

export function siblingsOf(nodes: PageNode[], parentId: string | null): PageNode[] {
  return parentId ? (findNode(nodes, parentId)?.children ?? []) : nodes
}

export function isDescendant(nodes: PageNode[], ancestorId: string, id: string): boolean {
  const ancestor = findNode(nodes, ancestorId)
  return ancestor ? findNode(ancestor.children, id) !== null : false
}

export function firstPageId(nodes: PageNode[]): string | null {
  return nodes[0]?.id ?? null
}

export type DropPosition = 'before' | 'after' | 'inside'

/** Parent and index (among siblings without the dragged page) for a sidebar drop. */
export function dropTarget(
  nodes: PageNode[],
  draggedId: string,
  targetId: string,
  position: DropPosition
): { parentId: string | null; index: number } | null {
  if (draggedId === targetId || isDescendant(nodes, draggedId, targetId)) return null
  if (position === 'inside') {
    const target = findNode(nodes, targetId)
    const count = target ? target.children.filter((c) => c.id !== draggedId).length : 0
    return { parentId: targetId, index: count }
  }
  const parentId = parentOf(nodes, targetId)?.id ?? null
  const siblings = siblingsOf(nodes, parentId).filter((n) => n.id !== draggedId)
  const at = siblings.findIndex((n) => n.id === targetId)
  return { parentId, index: position === 'before' ? at : at + 1 }
}
