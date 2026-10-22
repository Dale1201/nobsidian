import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
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
