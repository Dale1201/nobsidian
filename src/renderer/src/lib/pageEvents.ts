import type { PageMetaPatch } from '@shared/types'

/** Changes one tab makes to a page, for other tabs showing the same page. */
export type PageEvent =
  /** The app's own saves leave the file's revision as it was, so the saving editor names itself. */
  { type: 'saved'; id: string; source: object } | { type: 'meta'; id: string; patch: PageMetaPatch }

const listeners = new Set<(event: PageEvent) => void>()

export function emitPageEvent(event: PageEvent): void {
  for (const listener of listeners) listener(event)
}

export function onPageEvent(listener: (event: PageEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
