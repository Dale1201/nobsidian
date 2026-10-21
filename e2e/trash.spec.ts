import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, rowAction } from './helpers'

test('a deleted page opens read-only from Trash and can be restored', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Plans.md'), '---\nicon: 🗂️\n---\n\nKeep this safe.\n')
  await mkdir(join(nb.workspace, 'Plans'))
  await writeFile(join(nb.workspace, 'Plans', 'Child.md'), 'Inner.\n')
  await writeFile(join(nb.workspace, 'Other.md'), 'Other page.\n')
  const page = await nb.relaunch()
  await rowAction(page, 'Plans', 'Delete')
  await expect(page.getByTestId('sidebar-row-Plans')).toHaveCount(0)

  await page.getByRole('button', { name: 'Trash' }).click()
  const item = page.getByTestId('trash-item-Plans')
  await expect(item).toContainText('Top level')
  await item.click()
  await expect(page.getByRole('status')).toContainText('This page is in Trash.')
  await expect(page.locator(editor)).toContainText('Keep this safe.')
  await expect(page.locator(editor)).toHaveAttribute('contenteditable', 'false')

  await page.getByRole('button', { name: 'Restore page' }).click()
  await expect(page.getByTestId('sidebar-row-Plans')).toBeVisible()
  await expect(page.getByTestId('page-title')).toHaveText('Plans')
  expect(await readdir(join(nb.workspace, 'Plans'))).toEqual(['Child.md'])
  expect(await readdir(join(nb.workspace, '.nobsidian', 'trash'))).toEqual([])
})

test('delete forever asks first, then removes the page for good', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Scratch.md'), 'Temporary.\n')
  await writeFile(join(nb.workspace, 'Other.md'), 'Other page.\n')
  const page = await nb.relaunch()
  await rowAction(page, 'Scratch', 'Delete')
  await page.getByRole('button', { name: 'Trash' }).click()
  await page
    .getByTestId('trash-item-Scratch')
    .getByRole('button', { name: 'Delete forever' })
    .click()
  const confirm = page.getByRole('dialog', { name: 'Permanently delete "Scratch"?' })
  await expect(confirm).toContainText("This can't be undone.")
  await confirm.getByRole('button', { name: 'Delete forever' }).click()
  await expect.poll(() => readdir(join(nb.workspace, '.nobsidian', 'trash'))).toEqual([])
  await page.getByRole('button', { name: 'Trash' }).click()
  await expect(page.getByText('No pages in Trash')).toBeVisible()
})

test('back leaves a trashed page for the previous page', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'First.md'), 'First page.\n')
  await writeFile(join(nb.workspace, 'Second.md'), 'Second page.\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-First').click()
  await page.getByTestId('sidebar-row-Second').click()
  await rowAction(page, 'Second', 'Delete')
  await page.getByRole('button', { name: 'Trash' }).click()
  await page.getByTestId('trash-item-Second').click()
  await expect(page.getByRole('status')).toContainText('This page is in Trash.')

  await nb.app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Back')
      ?.click()
  )
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByTestId('page-title')).toHaveText('First')
})

test('the trashed page keeps a way back to the sidebar', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Scratch.md'), 'Temporary.\n')
  await writeFile(join(nb.workspace, 'Other.md'), 'Other page.\n')
  const page = await nb.relaunch()
  await rowAction(page, 'Scratch', 'Delete')
  await page.getByRole('button', { name: 'Trash' }).click()
  await page.getByTestId('trash-item-Scratch').click()
  await expect(page.getByRole('status')).toContainText('This page is in Trash.')

  await nb.app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Toggle Sidebar')
      ?.click()
  )
  await expect(page.getByTestId('sidebar')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect(page.getByTestId('sidebar')).toBeVisible()
})
