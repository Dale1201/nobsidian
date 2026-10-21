import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, waitForFile } from './helpers'

test('search shows recent pages, ranks title matches first and opens with the keyboard', async ({
  nb
}) => {
  await writeFile(join(nb.workspace, 'Groceries.md'), 'Apples and a website notebook.\n')
  await writeFile(join(nb.workspace, 'Website Redesign.md'), 'Plan the launch.\n')
  await writeFile(join(nb.workspace, 'Reading list.md'), 'Books.\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Reading list').click()
  await page.getByTestId('sidebar-row-Groceries').click()

  await page.keyboard.press('Meta+k')
  const dialog = page.getByRole('dialog', { name: 'Search' })
  const titles = dialog.locator('.search-item-title')
  await expect(dialog.locator('.search-section')).toHaveText('Recent')
  await expect(titles).toHaveText(['Groceries', 'Reading list'])

  await dialog.getByRole('textbox').fill('website')
  // Content is indexed in the background shortly after the workspace opens.
  await expect(titles).toHaveText(['Website Redesign', 'Groceries'])
  await expect(dialog.locator('.search-item-snippet').first()).toHaveText(
    'Apples and a website notebook.'
  )
  await expect(dialog.locator('.search-hit').first()).toHaveText('Website')

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('page-title')).toHaveText('Groceries')

  await nb.app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Search…')
      ?.click()
  )
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('Cmd+K on selected text adds a link instead of opening search', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Note.md'), 'Link this word.\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Note').click()
  await page.locator(editor).getByText('Link this word.').dblclick()
  // BlockNote binds its link shortcut only while the formatting toolbar is shown.
  await expect(page.locator('[data-test="createLink"]')).toBeVisible()
  await page.keyboard.press('Meta+k')
  await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0)
  await expect(page.getByPlaceholder('Edit URL')).toBeVisible()
})

test('closing search returns the cursor to the editor', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Note.md'), 'Some text.\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Note').click()
  await page.locator(editor).getByText('Some text.').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Meta+k')
  const dialog = page.getByRole('dialog', { name: 'Search' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.keyboard.type(' more')
  await waitForFile(join(nb.workspace, 'Note.md'), 'Some text. more')
})

test('clicking inside search keeps the keyboard working', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Groceries.md'), 'Apples.\n')
  await writeFile(join(nb.workspace, 'Reading list.md'), 'Books.\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Reading list').click()
  await page.getByTestId('sidebar-row-Groceries').click()

  await page.keyboard.press('Meta+k')
  const dialog = page.getByRole('dialog', { name: 'Search' })
  await expect(dialog.locator('.search-item-title')).toHaveText(['Groceries', 'Reading list'])
  await dialog.locator('.search-footer').click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('page-title')).toHaveText('Reading list')
})

test('Tab stays inside search', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Groceries.md'), 'Apples and a website notebook.\n')
  await writeFile(join(nb.workspace, 'Website Redesign.md'), 'Plan the launch.\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Groceries').click()

  await page.keyboard.press('Meta+k')
  const dialog = page.getByRole('dialog', { name: 'Search' })
  const input = dialog.getByRole('textbox')
  await input.fill('website')
  await expect(dialog.locator('.search-item').first()).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(input).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(input).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('page-title')).toHaveText('Groceries')
})
