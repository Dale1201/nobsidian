export interface OutlineNode {
  id: string
  children: OutlineNode[]
}

function readingOrder(nodes: OutlineNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.id)
    readingOrder(n.children, out)
  }
  return out
}

/** `canSelect` leaves out blocks that are not on screen, such as children of closed toggles. */
export function stepSelection(
  doc: OutlineNode[],
  ids: string[],
  delta: 1 | -1,
  extend: boolean,
  canSelect: (id: string) => boolean = () => true
): string[] {
  const order = readingOrder(doc).filter((id) => canSelect(id) || ids.includes(id))
  const edge = order.indexOf(delta === 1 ? ids[ids.length - 1] : ids[0])
  const next = order[Math.min(order.length - 1, Math.max(0, edge + delta))]
  if (!extend) return [next]
  const merged = delta === 1 ? [...ids, next] : [next, ...ids]
  return merged.filter((id, i) => merged.indexOf(id) === i)
}

/** The selected blocks without those whose parent is selected too; acting on a parent covers them. */
export function topLevelIds(doc: OutlineNode[], ids: string[]): string[] {
  const chosen = new Set(ids)
  const out: string[] = []
  const visit = (nodes: OutlineNode[]): void => {
    for (const n of nodes) {
      if (chosen.has(n.id)) out.push(n.id)
      else visit(n.children)
    }
  }
  visit(doc)
  return out
}
