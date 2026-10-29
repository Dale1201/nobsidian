import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, newTab } from './helpers'

test('a mention typed in another tab shows up as a backlink that opens its page', async ({
  nb
}) => {
  await writeFile(join(nb.workspace, 'Target.md'), 'the target\n')
  await writeFile(join(nb.workspace, 'Notes.md'), 'some notes\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Target').click()
  const pane = page.locator('.tab-pane.active')
  await expect(pane.getByTestId('page-title')).toHaveText('Target')
  await expect(pane.getByTestId('backlinks-button')).toHaveCount(0)

  await newTab(nb.app, page)
  await page.getByTestId('sidebar-row-Notes').click()
  await expect(pane.getByTestId('page-title')).toHaveText('Notes')
  await pane.locator(editor).getByText('some notes').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' @Targ')
  await expect(page.locator('.page-picker .menu-item-label').first()).toHaveText('Target')
  await page.keyboard.press('Enter')
  await expect(pane.locator(`${editor} .nb-mention`)).toHaveText(/Target/)

  await page.locator('.tab').first().click()
  await expect(pane.getByTestId('page-title')).toHaveText('Target')
  await expect(pane.getByTestId('backlinks-button')).toHaveText('1 backlink')
  await pane.getByTestId('backlinks-button').click()
  await page.getByTestId('backlink-Notes').click()
  await expect(pane.getByTestId('page-title')).toHaveText('Notes')
})

test("a parent's sub-page block alone is not a backlink", async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Parent.md'), '[Child](Parent/Child.md "page")\n')
  await mkdir(join(nb.workspace, 'Parent'))
  await writeFile(join(nb.workspace, 'Parent', 'Child.md'), 'child\n')
  await writeFile(join(nb.workspace, 'Index.md'), 'See [Child](Parent/Child.md)\n')
  const page = await nb.relaunch()
  const parent = page.getByTestId('sidebar-row-Parent')
  await parent.hover()
  await parent.getByRole('button', { name: 'Expand' }).click()
  await page.getByTestId('sidebar-row-Child').click()
  const pane = page.locator('.tab-pane.active')
  await expect(pane.getByTestId('page-title')).toHaveText('Child')
  await expect(pane.getByTestId('backlinks-button')).toHaveText('1 backlink')
  await pane.getByTestId('backlinks-button').click()
  await expect(page.locator('.backlinks-item')).toHaveCount(1)
  await expect(page.getByTestId('backlink-Index')).toBeVisible()
})
