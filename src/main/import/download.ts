import { extname } from 'node:path'

const TIMEOUT_MS = 20_000
const MAX_BYTES = 25 * 1024 * 1024

/** An image from the web, with a file name for it; throws when it is not a reasonable image. */
export async function downloadImage(
  url: string,
  fetchFn: typeof fetch = fetch
): Promise<{ name: string; data: Uint8Array }> {
  if (!/^https?:/i.test(url)) throw new Error('Not a web address')
  const response = await fetchFn(testOrigin(url), { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const type = response.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error(`Not an image: ${type}`)
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('Too large')
  const data = new Uint8Array(await response.arrayBuffer())
  if (data.byteLength > MAX_BYTES) throw new Error('Too large')
  let name = new URL(url).pathname.split('/').pop() ?? ''
  try {
    name = decodeURIComponent(name)
  } catch {
    // Keep it encoded.
  }
  if (!extname(name)) name = `${name || 'image'}.${type.slice(6).split(/[+;]/)[0]}`
  return { name, data }
}

/** End-to-end tests serve "web" images from a local server instead of the internet. */
function testOrigin(url: string): string {
  const origin = process.env.NOBSIDIAN_E2E === '1' ? process.env.NOBSIDIAN_E2E_WEB : undefined
  if (!origin) return url
  const u = new URL(url)
  return origin + u.pathname + u.search
}
