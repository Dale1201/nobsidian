import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { editor, newPage, rowAction, waitForFile } from './helpers'

test('duplicate copies a page and its sub-pages below the original', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Plan.md'), 'Body\n')
  await mkdir(join(nb.workspace, 'Plan'))
  await writeFile(join(nb.workspace, 'Plan', 'Step.md'), 'Step one\n')
  await writeFile(join(nb.workspace, 'Zebra.md'), 'Last\n')
  const page = await nb.relaunch()
  await rowAction(page, 'Plan', 'Duplicate')
  await expect(page.getByTestId('page-title')).toHaveText('Plan (1)')
  await expect(page.locator('.sidebar-section').last().locator('.sidebar-row-title')).toHaveText([
    'Plan',
    'Plan (1)',
    'Zebra',
    'New page'
  ])
  await expect(page.locator(editor)).toContainText('Body')
  expect(await readdir(join(nb.workspace, 'Plan (1)'))).toEqual(['Step.md'])
})

test('the top bar menu duplicates the open page', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Plan.md'), 'Body\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Plan').click()
  await expect(page.getByTestId('page-title')).toHaveText('Plan')
  await page.getByRole('button', { name: 'Page menu' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByTestId('page-title')).toHaveText('Plan (1)')
  await expect(page.locator(editor)).toContainText('Body')
  await waitForFile(join(nb.workspace, 'Plan (1).md'), 'Body')
})

test('move to picks a new parent from a searchable list', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Inbox.md'), 'Note\n')
  await writeFile(join(nb.workspace, 'Projects.md'), 'All projects\n')
  await writeFile(join(nb.workspace, 'Archive.md'), 'Old\n')
  const page = await nb.relaunch()
  await rowAction(page, 'Inbox', 'Move to')
  const picker = page.getByRole('dialog', { name: 'Move page to' })
  await page.keyboard.press('Meta+k')
  await expect(picker).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0)
  await expect(picker.locator('.search-item-title')).toHaveText([
    'Top level',
    'Archive',
    'Projects'
  ])
  await picker.getByRole('textbox').fill('proj')
  await expect(picker.locator('.search-item-title')).toHaveText(['Projects'])
  await page.keyboard.press('Enter')
  await expect
    .poll(() => readdir(join(nb.workspace, 'Projects')).catch(() => []))
    .toEqual(['Inbox.md'])
})

test('a table of contents lists the headings and jumps to them', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Guide')
  await page.keyboard.type('/toc')
  await page.keyboard.press('Enter')
  await expect(page.locator('.nb-toc-empty')).toHaveText(
    'Add headings to create a table of contents.'
  )
  await page.locator(editor).press('ArrowDown')
  await page.keyboard.type('# Intro')
  await page.keyboard.press('Enter')
  for (let i = 0; i < 40; i++) await page.keyboard.press('Enter')
  await page.keyboard.type('## Details')
  await expect(page.locator('.nb-toc-item')).toHaveText(['Intro', 'Details'])
  await waitForFile(join(workspace, 'Guide.md'), '<nav data-toc></nav>\n\n# Intro')

  const details = page.locator('h2', { hasText: 'Details' })
  await page.getByTestId('page-scroll').evaluate((el) => el.scrollTo(0, 0))
  await expect(details).not.toBeInViewport()
  await page.locator('.nb-toc-item', { hasText: 'Details' }).click()
  await expect(details).toBeInViewport()
})

test('a table of contents entry opens from the keyboard', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Keys')
  await page.keyboard.type('/toc')
  await page.keyboard.press('Enter')
  await page.locator(editor).press('ArrowDown')
  await page.keyboard.type('# Intro')
  await page.keyboard.press('Enter')
  for (let i = 0; i < 40; i++) await page.keyboard.press('Enter')
  await page.keyboard.type('## Details')
  const details = page.locator('h2', { hasText: 'Details' })
  await page.getByTestId('page-scroll').evaluate((el) => el.scrollTo(0, 0))
  await expect(details).not.toBeInViewport()
  await page.locator('.nb-toc').getByRole('button', { name: 'Details' }).focus()
  await page.keyboard.press('Enter')
  await expect(details).toBeInViewport()
})

test('a table of contents follows heading edits', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Live')
  await page.keyboard.type('/toc')
  await page.keyboard.press('Enter')
  await page.locator(editor).press('ArrowDown')
  await page.keyboard.type('# Intro')
  await expect(page.locator('.nb-toc-item')).toHaveText(['Intro'])
  await page.keyboard.type('duction')
  await expect(page.locator('.nb-toc-item')).toHaveText(['Introduction'])
  await page.keyboard.press('Shift+Meta+ArrowLeft')
  await page.keyboard.press('Backspace')
  await expect(page.locator('.nb-toc-item')).toHaveText(['Untitled'])
  await page.keyboard.press('Backspace')
  await expect(page.locator('.nb-toc-item')).toHaveCount(0)
  await expect(page.locator('.nb-toc-empty')).toBeVisible()
})

/** The editor reads the selection asynchronously; its toolbar shows exactly when it has. */
async function selectWordBeforeCursor(page: Page): Promise<void> {
  const toolbar = page.locator('[data-test="colors"]')
  await expect(toolbar).toBeHidden()
  await page.keyboard.press('Shift+Alt+ArrowLeft')
  await expect(toolbar).toBeVisible()
}

test('Cmd+Shift+H applies the last color picked in the toolbar', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Colors')
  await page.keyboard.type('alpha beta')
  // Saved means the editor has applied the typing, so it cannot reset the selection made next.
  await waitForFile(join(workspace, 'Colors.md'), 'alpha beta')
  await selectWordBeforeCursor(page)
  await page.keyboard.press('Meta+Shift+h')
  await waitForFile(join(workspace, 'Colors.md'), 'alpha <span data-bg="yellow">beta</span>')

  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+Alt+ArrowRight')
  // "alpha" has no color yet, unlike the "beta" selected before.
  await expect(
    page.locator('[data-test="colors"] .bn-color-icon[data-background-color="default"]')
  ).toBeVisible()
  await page.locator('[data-test="colors"]').click()
  await page.locator('[data-test="text-color-red"]').click()
  await waitForFile(join(workspace, 'Colors.md'), '<span data-color="red">alpha</span>')

  await page.locator(editor).getByText('beta').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' gamma')
  await waitForFile(join(workspace, 'Colors.md'), 'gamma')
  await selectWordBeforeCursor(page)
  await page.keyboard.press('Meta+Shift+h')
  await waitForFile(join(workspace, 'Colors.md'), '<span data-color="red">gamma</span>')
})

test('Cmd+Shift+H a second time removes the color again', async ({ nb }) => {
  const { page, workspace } = nb
  const file = join(workspace, 'Toggle.md')
  await newPage(page, 'Toggle')
  await page.keyboard.type('alpha beta')
  await waitForFile(file, 'alpha beta')
  await selectWordBeforeCursor(page)
  await page.keyboard.press('Meta+Shift+h')
  await waitForFile(file, 'alpha <span data-bg="yellow">beta</span>')
  await page.keyboard.press('Meta+Shift+h')
  await expect.poll(async () => (await readFile(file, 'utf8')).includes('data-bg')).toBe(false)
  expect(await readFile(file, 'utf8')).toContain('alpha beta')
})

test('the last picked color survives a restart', async ({ nb }) => {
  const { page, workspace, userData } = nb
  const file = join(workspace, 'Persist.md')
  await newPage(page, 'Persist')
  await page.keyboard.type('alpha beta')
  await waitForFile(file, 'alpha beta')
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+Alt+ArrowRight')
  await expect(page.locator('[data-test="colors"]')).toBeVisible()
  await page.locator('[data-test="colors"]').click()
  await page.locator('[data-test="text-color-red"]').click()
  await waitForFile(file, '<span data-color="red">alpha</span>')
  await waitForFile(join(userData, 'settings.json'), '"red"')

  const relaunched = await nb.relaunch()
  await relaunched.locator(editor).getByText('beta').click()
  await relaunched.keyboard.press('End')
  await relaunched.keyboard.type(' gamma')
  await waitForFile(file, 'gamma')
  await selectWordBeforeCursor(relaunched)
  await relaunched.keyboard.press('Meta+Shift+h')
  await waitForFile(file, '<span data-color="red">gamma</span>')
})
