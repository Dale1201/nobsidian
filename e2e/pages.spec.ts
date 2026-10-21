import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { rowAction } from './helpers'

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
