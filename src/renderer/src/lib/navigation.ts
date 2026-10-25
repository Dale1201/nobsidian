import { useApp, type TabTarget } from '../store'
import { pageIdForHref } from './tree'

const api = window.api

/** What a click carries that decides where a page opens. */
export interface LinkClick {
  button: number
  metaKey: boolean
  shiftKey: boolean
}

/** Cmd-click and middle-click open a background tab; adding Shift brings it to the front. */
export function tabTarget(click: LinkClick): TabTarget {
  if (click.button !== 1 && !click.metaKey) return 'current'
  return click.shiftKey ? 'foreground' : 'background'
}

/** Routes a link click: pages open in the app, attachments in their default app, the rest in the browser. */
export function openHref(href: string, click?: LinkClick): void {
  const { tree, openPage } = useApp.getState()
  const pageId = pageIdForHref(tree, href)
  if (pageId) return openPage(pageId, { tab: click ? tabTarget(click) : 'current' })
  if (href.startsWith('/') && !href.startsWith('//')) {
    void api.invoke('attachment:open', { href })
    return
  }
  void api.invoke('shell:openExternal', { url: href })
}
