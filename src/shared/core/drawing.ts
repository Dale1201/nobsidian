import { decodeHref } from './paths'

export const DRAWING_SUFFIX = '.excalidraw.svg'

export function isDrawingHref(href: string): boolean {
  return decodeHref(href).toLowerCase().endsWith(DRAWING_SUFFIX)
}

/** The file name a drawing is saved under: its current stem without a "(2)" counter, or "Drawing". */
export function drawingFileName(href: string): string {
  const file = decodeHref(href).split('/').pop() ?? ''
  const stem = file.slice(0, -DRAWING_SUFFIX.length).replace(/ \(\d+\)$/, '')
  return (isDrawingHref(href) && stem ? stem : 'Drawing') + DRAWING_SUFFIX
}
