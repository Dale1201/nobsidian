import { describe, expect, it } from 'vitest'
import { downloadImage } from './download'

function serve(body: BodyInit, headers: Record<string, string>, status = 200): typeof fetch {
  return (async () => new Response(body, { status, headers })) as unknown as typeof fetch
}

describe('downloadImage', () => {
  it('names the image after the address, adding an extension from its type', async () => {
    const png = serve(new Uint8Array([1, 2]), { 'content-type': 'image/png' })
    expect(await downloadImage('https://x.com/a/My%20Photo.jpg?w=1', png)).toEqual({
      name: 'My Photo.jpg',
      data: new Uint8Array([1, 2])
    })
    expect((await downloadImage('https://x.com/a/photo', png)).name).toBe('photo.png')
    const svg = serve('<svg/>', { 'content-type': 'image/svg+xml' })
    expect((await downloadImage('https://x.com/', svg)).name).toBe('image.svg')
  })

  it('refuses what is not an image, a failed response, or something too large', async () => {
    await expect(
      downloadImage('https://x.com/a', serve('<html>', { 'content-type': 'text/html' }))
    ).rejects.toThrow('Not an image')
    await expect(
      downloadImage('https://x.com/a', serve('', { 'content-type': 'image/png' }, 404))
    ).rejects.toThrow('HTTP 404')
    await expect(
      downloadImage(
        'https://x.com/a',
        serve('', { 'content-type': 'image/png', 'content-length': String(200 * 1024 * 1024) })
      )
    ).rejects.toThrow('Too large')
    await expect(downloadImage('file:///etc/passwd')).rejects.toThrow('Not a web address')
  })

  it('stops reading a body that grows past the cap when it has no content-length', async () => {
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024))
      }
    })
    await expect(
      downloadImage('https://x.com/a', serve(endless, { 'content-type': 'image/png' }))
    ).rejects.toThrow('Too large')
  })
})
