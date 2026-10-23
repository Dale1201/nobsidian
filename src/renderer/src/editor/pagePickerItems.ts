export interface PickerPage {
  id: string
  title: string
  icon?: string
  /** Muted parent path, such as "Notes / Rust". */
  path: string
}

export function rankPages(
  pages: PickerPage[],
  recent: string[],
  query: string,
  limit = 8
): PickerPage[] {
  const q = query.trim().toLowerCase()
  const score = (p: PickerPage): number => {
    const title = (p.title || 'Untitled').toLowerCase()
    if (!q) {
      const r = recent.indexOf(p.id)
      return r === -1 ? recent.length : r
    }
    if (title.startsWith(q)) return 0
    if (title.includes(q)) return 1
    return -1
  }
  return pages
    .map((page, index) => ({ page, index, s: score(page) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.page)
}
