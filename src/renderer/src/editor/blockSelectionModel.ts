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

export function stepSelection(
  doc: OutlineNode[],
  ids: string[],
  delta: 1 | -1,
  extend: boolean
): string[] {
  const order = readingOrder(doc)
  const edge = order.indexOf(delta === 1 ? ids[ids.length - 1] : ids[0])
  const next = order[Math.min(order.length - 1, Math.max(0, edge + delta))]
  if (!extend) return [next]
  const merged = delta === 1 ? [...ids, next] : [next, ...ids]
  return merged.filter((id, i) => merged.indexOf(id) === i)
}
