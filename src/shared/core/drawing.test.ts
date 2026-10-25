import { describe, expect, it } from 'vitest'
import { drawingFileName, isDrawingHref } from './drawing'
import { mapBlockLinks } from './links'

describe('drawing files', () => {
  it('recognises drawings by their double extension, in any case and encoding', () => {
    expect(isDrawingHref('/attachments/Drawing.excalidraw.svg')).toBe(true)
    expect(isDrawingHref('attachments/My%20Sketch.EXCALIDRAW.svg')).toBe(true)
    expect(isDrawingHref('/attachments/logo.svg')).toBe(false)
    expect(isDrawingHref('/attachments/Drawing.excalidraw')).toBe(false)
  })

  it('names a save after the current file, without its counter', () => {
    expect(drawingFileName('')).toBe('Drawing.excalidraw.svg')
    expect(drawingFileName('/attachments/Drawing%20(3).excalidraw.svg')).toBe(
      'Drawing.excalidraw.svg'
    )
    expect(drawingFileName('/attachments/Cat%20(2023).excalidraw.svg')).toBe('Cat.excalidraw.svg')
    expect(drawingFileName('/attachments/Floor%20plan.excalidraw.svg')).toBe(
      'Floor plan.excalidraw.svg'
    )
    expect(drawingFileName('/attachments/photo.png')).toBe('Drawing.excalidraw.svg')
  })

  it('has its link rewritten like an image', () => {
    const [block] = mapBlockLinks(
      [{ type: 'drawing', props: { url: '/attachments/a.excalidraw.svg' }, children: [] }],
      (href) => `../${href.slice(1)}`
    )
    expect(block.props).toEqual({ url: '../attachments/a.excalidraw.svg' })
  })
})
