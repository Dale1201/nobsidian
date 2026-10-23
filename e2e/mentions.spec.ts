import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, newPage, waitForFile } from './helpers'

test('@ links a page as a mention that opens it', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Roadmap.md'), '---\nicon: 🗺️\n---\n\nplan\n')
  const page = await nb.relaunch()
  await expect(page.getByTestId('sidebar-row-Roadmap')).toBeVisible()
  await newPage(page, 'Notes')
  await page.keyboard.type('See @road')
  await expect(page.locator('.page-picker .menu-item-label').first()).toHaveText('Roadmap')
  await page.keyboard.press('Enter')
  const chip = page.locator(`${editor} .nb-mention`)
  await expect(chip).toHaveText('🗺️Roadmap')
  await waitForFile(join(nb.workspace, 'Notes.md'), 'See [Roadmap](Roadmap.md "mention")')
  await chip.click()
  await expect(page.getByTestId('page-title')).toHaveText('Roadmap')
})

test('[[ opens the same picker and can create a page', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Hub')
  await page.keyboard.type('[[Brand new')
  const create = page.locator('.page-picker .menu-item', { hasText: 'New page' })
  await expect(create).toContainText('Brand new')
  await create.click()
  await expect(page.locator(`${editor} .nb-mention`)).toHaveText(/Brand new/)
  await expect(page.getByTestId('sidebar-row-Brand new')).toBeVisible()
  const saved = await waitForFile(join(nb.workspace, 'Hub.md'), '"mention")')
  expect(saved).toContain('[Brand new](Hub/Brand%20new.md "mention")')
  expect(saved).not.toContain('[[')
})

test('a mention shows the new title after a rename, and goes grey when the page is deleted', async ({
  nb
}) => {
  await writeFile(join(nb.workspace, 'Target.md'), 't\n')
  await writeFile(join(nb.workspace, 'Source.md'), 'Go to [Target](Target.md "mention")\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Source').click()
  const row = page.getByTestId('sidebar-row-Target')
  await row.hover()
  await row.getByRole('button', { name: 'Page actions' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('Renamed')
  await page.keyboard.press('Enter')
  await expect(page.locator(`${editor} .nb-mention`)).toHaveText(/Renamed/)
  const renamed = page.getByTestId('sidebar-row-Renamed')
  await renamed.hover()
  await renamed.getByRole('button', { name: 'Page actions' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.locator(`${editor} .nb-mention`)).toHaveAttribute('data-missing', 'true')
})
