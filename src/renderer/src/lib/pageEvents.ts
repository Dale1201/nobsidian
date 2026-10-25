import type { PageMetaPatch } from '@shared/types'

/** Changes one tab makes to a page, for other tabs showing the same page. */
export type PageEvent =
  /** The app's own saves leave the file's revision as it was, so the saving editor names itself. */
  { type: 'saved'; id: string; source: object } | { type: 'meta'; id: string; patch: PageMetaPatch }

const listeners = new Set<(event: PageEvent) => void>()
const saves = new Map<string, number>()

export function emitPageEvent(event: PageEvent): void {
  if (event.type === 'saved') saves.set(event.id, saveCount(event.id) + 1)
  for (const listener of listeners) listener(event)
}

/** Saves announced for a page so far, so a reader can tell whether one landed while it read. */
export function saveCount(id: string): number {
  return saves.get(id) ?? 0
}

export function onPageEvent(listener: (event: PageEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
