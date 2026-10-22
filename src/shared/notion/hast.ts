import type { Element, ElementContent, Root, RootContent } from 'hast'

export type Node = Root | RootContent | ElementContent

export function isElement(node: Node | undefined): node is Element
export function isElement(node: Node | undefined, tag: string): boolean
export function isElement(node: Node | undefined, tag?: string): boolean {
  return node?.type === 'element' && (tag === undefined || node.tagName === tag)
}

export function classes(el: Element): string[] {
  const value: unknown = el.properties.className
  return Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(' ')
      : []
}

export function hasClass(el: Element, name: string): boolean {
  return classes(el).includes(name)
}

/** An attribute by its HTML name (`data-notion-page-id`), whatever hast calls the property. */
export function attr(el: Element, name: string): string | undefined {
  const key = name.startsWith('data-')
    ? 'data' + name.slice(4).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    : name
  const value = el.properties[key]
  if (value === undefined || value === null || value === false) return undefined
  return Array.isArray(value) ? value.join(' ') : String(value)
}

export function elements(node: Element | Root): Element[] {
  const children: RootContent[] = node.children
  return children.filter((c): c is Element => c.type === 'element')
}

export function find(node: Node, test: (el: Element) => boolean): Element | undefined {
  if (isElement(node) && test(node)) return node
  if ('children' in node) {
    for (const child of node.children) {
      const hit = find(child, test)
      if (hit) return hit
    }
  }
  return undefined
}

export function findAll(
  node: Node,
  test: (el: Element) => boolean,
  out: Element[] = []
): Element[] {
  if (isElement(node) && test(node)) out.push(node)
  if ('children' in node) for (const child of node.children) findAll(child, test, out)
  return out
}

export function textOf(node: Node): string {
  if (node.type === 'text') return node.value
  if (isElement(node, 'br')) return '\n'
  if ('children' in node) return node.children.map(textOf).join('')
  return ''
}
