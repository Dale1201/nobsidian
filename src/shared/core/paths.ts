// Posix path helpers for workspace-relative paths ("Projects/Plan.md").
// No node:path so the renderer can use them too.

const FORBIDDEN = new Set([...'/\\:*?"<>|'])
// macOS allows 255 bytes per name; leave room for " (2)" and ".md".
const MAX_NAME_BYTES = 200
const utf8 = new TextEncoder()

export function sanitizeTitle(title: string): string {
  const cleaned = [...title]
    .map((c) => (FORBIDDEN.has(c) || c.charCodeAt(0) < 32 ? '-' : c))
    .join('')
    .replace(/^\.+/, '-')
    .trim()
  if (cleaned === '') return 'Untitled'
  let out = ''
  let bytes = 0
  for (const ch of cleaned) {
    bytes += utf8.encode(ch).length
    if (bytes > MAX_NAME_BYTES) break
    out += ch
  }
  return out.trim() || 'Untitled'
}

export function stemOf(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.md$/i, '')
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter((p) => p !== '').join('/'))
}

export function normalizePath(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** Folder holding a page's children: "Projects.md" -> "Projects". */
export function childDirOf(pagePath: string): string {
  return pagePath.replace(/\.md$/i, '')
}

export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')
}

export function encodeHref(path: string): string {
  return path
    .split('/')
    .map((seg) => (seg === '..' || seg === '.' ? seg : encodeURIComponent(seg)))
    .join('/')
}

export function decodeHref(href: string): string {
  const clean = href.split('#')[0].split('?')[0]
  try {
    return decodeURIComponent(clean)
  } catch {
    return clean
  }
}

/** Workspace-relative target of `href` written inside the file at `fromFile`. */
export function resolveHref(fromFile: string, href: string): string {
  const decoded = decodeHref(href)
  if (decoded.startsWith('/')) return normalizePath(decoded)
  return joinPath(dirOf(fromFile), decoded)
}

/** Href from the file at `fromFile` to the workspace path `target`. */
export function relativeHref(fromFile: string, target: string): string {
  const from = dirOf(fromFile).split('/').filter(Boolean)
  const to = target.split('/').filter(Boolean)
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  const up = from.slice(common).map(() => '..')
  return encodeHref([...up, ...to.slice(common)].join('/'))
}
