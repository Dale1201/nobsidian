import { expect, test } from './fixtures'
import { newPage } from './helpers'

test('page actions menu works from the keyboard', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Alpha')
  const row = page.getByTestId('sidebar-row-Alpha')
  await row.hover()
  await row.getByRole('button', { name: 'Page actions' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.locator('.menu-item.active')).toHaveText('Add to Favorites')
  await page.keyboard.press('ArrowDown')
  await expect(menu.locator('.menu-item.active')).toHaveText('Duplicate')
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
  await expect(menu.locator('.menu-item.active')).toHaveText('Rename')
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
