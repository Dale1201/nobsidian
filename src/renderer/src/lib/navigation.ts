import { useApp } from '../store'
import { pageIdForHref } from './tree'

const api = window.api

/** Routes a link click: pages open in the app, attachments in their default app, the rest in the browser. */
export function openHref(href: string): void {
  const { tree, openPage } = useApp.getState()
  const pageId = pageIdForHref(tree, href)
  if (pageId) return openPage(pageId)
  if (href.startsWith('/') && !href.startsWith('//')) {
    void api.invoke('attachment:open', { href })
    return
  }
  void api.invoke('shell:openExternal', { url: href })
}
