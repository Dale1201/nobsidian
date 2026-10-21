import { pageIdFromHref } from '@shared/core/links'
import { useApp } from '../store'

const api = window.api

/** Routes a link click: pages open in the app, attachments in their default app, the rest in the browser. */
export function openHref(href: string): void {
  const pageId = pageIdFromHref(href)
  if (pageId) return useApp.getState().openPage(pageId)
  if (href.startsWith('/') && !href.startsWith('//')) {
    void api.invoke('attachment:open', { href })
    return
  }
  void api.invoke('shell:openExternal', { url: href })
}
