import { ASSET_SCHEME } from '@shared/ipc'

/** Internal workspace hrefs ("/attachments/x.png") become URLs the main process serves. */
export function resolveAssetUrl(href: string): string {
  if (href.startsWith('/') && !href.startsWith('//')) return `${ASSET_SCHEME}://workspace${href}`
  return href
}
