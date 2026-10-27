import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect } from './fixtures'

export const editor = '.bn-editor'

/** Waits until the freshly created page is showing, so typing can't land in the previous one. */
export async function typeNewPageTitle(page: Page, title: string): Promise<void> {
  const heading = page.getByTestId('page-title')
  await expect(heading).toHaveText('')
  await expect(heading).toBeFocused()
  await page.keyboard.type(title)
}

export async function waitForFile(path: string, match: RegExp | string): Promise<string> {
  let text = ''
  await expect
    .poll(async () => {
      text = await readFile(path, 'utf8').catch(() => '')
      return typeof match === 'string' ? text.includes(match) : match.test(text)
    })
    .toBe(true)
  return text
}

/** Creates a top-level page with a title and leaves the cursor in its body. */
export async function newPage(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, title)
  await expect(page.getByTestId(`sidebar-row-${title}`)).toBeVisible()
  await page.keyboard.press('Enter')
}

export async function rowAction(page: Page, title: string, action: string): Promise<void> {
  const row = page.getByTestId(`sidebar-row-${title}`)
  await row.hover()
  await row.getByRole('button', { name: 'Page actions' }).click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

/** Writes a page file, relaunches so the app reads it, and opens it. */
export async function openFile(
  nb: { workspace: string; relaunch: () => Promise<Page> },
  name: string,
  body: string
): Promise<Page> {
  await writeFile(join(nb.workspace, `${name}.md`), body)
  const page = await nb.relaunch()
  await page.getByTestId(`sidebar-row-${name}`).click()
  await expect(page.locator(editor)).toBeVisible()
  return page
}

/** Clicks a native menu item; Playwright's key presses never reach the menu. */
export async function clickMenuItem(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ Menu }, label) => {
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === label)
      ?.click()
  }, label)
}

/** A menu click reaches the window later, so this waits for the new tab before anything acts on it. */
export async function newTab(app: ElectronApplication, page: Page): Promise<void> {
  const tabs = page.locator('.tab')
  const count = await tabs.count()
  await clickMenuItem(app, 'New Tab')
  await expect(tabs).toHaveCount(count + 1)
}

/**
 * ProseMirror reads a caret moved by a click or a key on the next `selectionchange`, so a key
 * pressed at once would act on the old caret. Waits until the editor's selection is the DOM's.
 */
async function settleCaret(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        type Editor = {
          state: { selection: { anchor: number; head: number } }
          view: { posAtDOM: (node: Node, offset: number) => number }
        }
        const editor = (document.activeElement?.closest('.ProseMirror') as { editor?: Editor })
          ?.editor
        const dom = getSelection()
        if (!editor || !dom?.anchorNode || !dom.focusNode) return false
        const { anchor, head } = editor.state.selection
        return (
          editor.view.posAtDOM(dom.anchorNode, dom.anchorOffset) === anchor &&
          editor.view.posAtDOM(dom.focusNode, dom.focusOffset) === head
        )
      })
    )
    .toBe(true)
}

export async function placeCaret(target: Locator, clickCount = 1): Promise<void> {
  await target.click({ clickCount })
  // A click that focuses the editor makes ProseMirror put its caret back 20ms later; a key
  // pressed before then is undone. Timers run in deadline order, so this one fires after it.
  await target.page().evaluate(() => new Promise((r) => setTimeout(r, 20)))
  await settleCaret(target.page())
}

export async function clickInEditor(page: Page, text: string, clickCount = 1): Promise<void> {
  await placeCaret(page.locator(editor).getByText(text), clickCount)
}

export async function pressInEditor(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key)
  await settleCaret(page)
}

/** Chromium now and then drops a Cmd+Right pressed just after a click, so it is pressed until it lands. */
export async function caretToLineEnd(page: Page): Promise<void> {
  await expect(async () => {
    await pressInEditor(page, 'Meta+ArrowRight')
    const atEnd = await page.evaluate(() => {
      type Editor = {
        state: {
          selection: {
            empty: boolean
            $head: { parentOffset: number; parent: { content: { size: number } } }
          }
        }
      }
      const editor = (document.activeElement?.closest('.ProseMirror') as { editor?: Editor })
        ?.editor
      const { empty, $head } = editor!.state.selection
      return empty && $head.parentOffset === $head.parent.content.size
    })
    expect(atEnd).toBe(true)
  }).toPass({ timeout: 5000 })
}
