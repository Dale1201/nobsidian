import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { newPage } from './helpers'

test('page actions menu works from the keyboard', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Alpha')
  const row = page.getByTestId('sidebar-row-Alpha')
  await row.hover()
  await row.getByRole('button', { name: 'Page actions' }).click()
  const menu = page.getByRole('menu')
  const active = menu.locator('.menu-item.active .menu-item-label')
  await expect(active).toHaveText('Add to Favorites')
  await page.keyboard.press('ArrowDown')
  await expect(active).toHaveText('Duplicate')
  const rows = page.locator('[data-testid^="sidebar-row-"]')
  const before = await rows.count()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(rows).toHaveCount(before + 1)
})

test('hovering an item highlights it, and Escape closes the menu', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Beta')
  const row = page.getByTestId('sidebar-row-Beta')
  await row.hover()
  await row.getByRole('button', { name: 'Page actions' }).click()
  const menu = page.getByRole('menu')
  await menu.getByRole('menuitem', { name: 'Rename' }).hover()
  await expect(menu.locator('.menu-item.active .menu-item-label')).toHaveText('Rename')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('a menu opened near the window edge stays on screen', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Gamma')
  await page.getByRole('button', { name: 'Page menu' }).click()
  const box = await page.getByRole('menu').boundingBox()
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height)
})

test('the trash popover and icon picker keep their own widths', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Widths')
  await page.getByRole('button', { name: 'Trash', exact: true }).click()
  expect((await page.locator('.menu.trash-popover').boundingBox())!.width).toBe(414)
  await page.keyboard.press('Escape')
  await page.getByTestId('page-title').hover()
  await page.getByRole('button', { name: 'Add icon' }).click()
  await page.getByTestId('page-icon').click()
  const panel = (await page.locator('.menu.icon-picker').boundingBox())!
  const picker = (await page.locator('.nb-icon-picker').boundingBox())!
  expect(panel.width).toBeGreaterThanOrEqual(picker.width)
})

test('a menu keeps its highlight when the app updates behind it', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Steady')
  await page.getByRole('button', { name: 'Page menu' }).click()
  const active = page.getByRole('menu').locator('.menu-item.active .menu-item-label')
  await page.keyboard.press('ArrowDown')
  await expect(active).toHaveText('Move to')
  await writeFile(join(nb.workspace, 'Arrived.md'), 'new\n')
  await expect(page.getByTestId('sidebar-row-Arrived')).toBeVisible()
  await expect(active).toHaveText('Move to')
})
