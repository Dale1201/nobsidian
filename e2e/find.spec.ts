import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { editor, menu, newTab, openFile, placeCaret, waitForFile } from './helpers'

const bar = (page: Page): Locator => page.locator('.tab-pane.active [data-testid="find-bar"]')
const count = (page: Page): Locator => bar(page).getByTestId('find-count')

/** A menu click reaches the window later, so typing waits for the find field to take focus. */
async function openFind(app: ElectronApplication, page: Page, label = 'Find…'): Promise<void> {
  await menu(app, label)
  await expect(bar(page).getByTestId('find-input')).toBeFocused()
}

test('Cmd+F finds, steps through matches and leaves the match selected', async ({ nb }) => {
  const page = await openFile(nb, 'Fruit', 'Apple pie\n\nan apple a day\n\nNo fruit here\n\nAPPLE\n')
  await openFind(nb.app, page)
  await page.keyboard.type('apple')
  await expect(count(page)).toHaveText('1/3')
  await expect(page.locator(`${editor} .nb-find-match`)).toHaveCount(3)
  await expect(page.locator(`${editor} .nb-find-current`)).toHaveText('Apple')
  await page.keyboard.press('Enter')
  await expect(count(page)).toHaveText('2/3')
  await expect(page.locator(`${editor} .nb-find-current`)).toHaveText('apple')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Shift+Enter')
  await expect(count(page)).toHaveText('3/3')
  await menu(nb.app, 'Find Next')
  await expect(count(page)).toHaveText('1/3')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('xyz')
  await expect(count(page)).toHaveText('No results')
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('day')
  await page.keyboard.press('Escape')
  await expect(bar(page)).toHaveCount(0)
  await expect(page.locator(`${editor} .nb-find-match`)).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('day')
})

test('the bar opens with the selected text', async ({ nb }) => {
  const page = await openFile(nb, 'Words', 'one\n\ntwo and one\n')
  await placeCaret(page.locator(editor).getByText('one', { exact: true }), 2)
  await menu(nb.app, 'Find…')
  await expect(bar(page).getByTestId('find-input')).toHaveValue('one')
  await expect(count(page)).toHaveText('1/2')
})

test('replace changes one match, replace all the rest, and one undo restores them', async ({
  nb
}) => {
  const page = await openFile(nb, 'Colors', 'red, **red** and red\n')
  await openFind(nb.app, page, 'Find and Replace…')
  await page.keyboard.type('red')
  await expect(count(page)).toHaveText('1/3')
  await bar(page).getByTestId('replace-input').fill('blue')
  await bar(page).getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(page.locator(editor)).toContainText('blue, red and red')
  await expect(count(page)).toHaveText('1/2')
  await bar(page).getByRole('button', { name: 'Replace all' }).click()
  await expect(page.locator(editor)).toContainText('blue, blue and blue')
  await expect(count(page)).toHaveText('No results')
  await waitForFile(join(nb.workspace, 'Colors.md'), 'blue, **blue** and blue')
  await page.keyboard.press('Escape')
  await expect(page.locator(editor)).toBeFocused()
  await page.keyboard.press('Meta+z')
  await expect(page.locator(editor)).toContainText('blue, red and red')
})

test('a match inside a closed toggle opens it', async ({ nb }) => {
  const page = await openFile(
    nb,
    'Toggles',
    '<details>\n<summary>Open me</summary>\n\nHidden needle\n\n</details>\n'
  )
  const hidden = page.locator(editor).getByText('Hidden needle')
  await expect(hidden).toBeHidden()
  await openFind(nb.app, page)
  await page.keyboard.type('needle')
  await expect(count(page)).toHaveText('1/1')
  await expect(hidden).toBeVisible()
  await expect(page.locator(`${editor} .bn-toggle-button`)).toHaveAttribute('aria-expanded', 'true')
})

test('each tab keeps its own find bar', async ({ nb }) => {
  const page = await openFile(nb, 'First', 'alpha beta\n')
  await openFind(nb.app, page)
  await page.keyboard.type('beta')
  await expect(count(page)).toHaveText('1/1')
  await newTab(nb.app, page)
  await expect(bar(page)).toHaveCount(0)
  await page.getByTestId('sidebar-row-First').click()
  await expect(page.locator('.tab-pane.active').getByTestId('page-title')).toHaveText('First')
  await expect(bar(page)).toHaveCount(0)
  await page.locator('.tab').first().click()
  await expect(count(page)).toHaveText('1/1')
})
