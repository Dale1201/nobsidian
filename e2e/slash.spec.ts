import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, newPage, waitForFile } from './helpers'

test('the slash menu looks like Notion', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Slash')
  await page.keyboard.type('/')
  const menu = page.locator('.slash-menu')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.menu-section').first()).toHaveText('Basic blocks')
  const items = menu.locator('.menu-item')
  await expect(items.first().locator('.menu-item-label')).toHaveText('Text')
  await expect(
    menu.getByRole('option', { name: /^Heading 1/ }).locator('.menu-item-hint')
  ).toHaveText('#')
  await expect(
    menu.getByRole('option', { name: /To-do list/ }).locator('.menu-item-hint')
  ).toHaveText('[]')
  const heights = await items.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height)
  )
  expect(heights.every((h) => h === 28)).toBe(true)
  await expect(menu).not.toContainText('⌘')
  await expect(menu.locator('.slash-menu-footer')).toContainText("Type '/' on the page")
  expect((await menu.boundingBox())!.width).toBe(324)
})

test('typing filters and Enter turns the block into the choice', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Filter')
  await page.keyboard.type('/head')
  await expect(page.locator('.slash-menu .menu-item-label')).toHaveText([
    'Heading 1',
    'Heading 2',
    'Heading 3',
    'Toggle heading 1',
    'Toggle heading 2',
    'Toggle heading 3'
  ])
  await page.keyboard.press('Enter')
  await page.keyboard.type('Title')
  await waitForFile(join(nb.workspace, 'Filter.md'), '# Title')
})

test('no results, then a space, closes the menu like Notion', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Nothing')
  await page.keyboard.type('/zzzz')
  await expect(page.locator('.slash-menu .menu-empty')).toHaveText('No results')
  await page.keyboard.type(' ')
  await expect(page.locator('.slash-menu')).toBeHidden()
  await expect(page.locator(editor)).toContainText('/zzzz')
})

test('the menu flips above the cursor at the bottom of the window', async ({ nb }) => {
  const body = Array.from({ length: 80 }, (_, i) => `Line ${i}`).join('\n\n') + '\n'
  await writeFile(join(nb.workspace, 'Long.md'), body)
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Long').click()
  const last = page.locator(`${editor} .bn-block-content`).last()
  await last.scrollIntoViewIfNeeded()
  await last.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  const box = (await page.locator('.slash-menu').boundingBox())!
  const height = await page.evaluate(() => innerHeight)
  expect(box.y + box.height).toBeLessThanOrEqual(height)
  expect(box.y).toBeGreaterThanOrEqual(0)
})

test('the whole menu stays on screen when it opens mid-window', async ({ nb }) => {
  const body = Array.from({ length: 80 }, (_, i) => `Line ${i}`).join('\n\n') + '\n'
  await writeFile(join(nb.workspace, 'Middle.md'), body)
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Middle').click()
  const height = await page.evaluate(() => innerHeight)
  for (const room of [320, 360, 400]) {
    const line = page.locator(`${editor} .bn-block-content`, { hasText: /^Line 40$/ })
    await line.evaluate((el, gap) => {
      const scroller = document.querySelector('[data-testid="page-scroll"]')!
      const r = el.getBoundingClientRect()
      scroller.scrollTop += r.bottom - (innerHeight - gap)
    }, room)
    await line.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' /')
    const footer = page.locator('.slash-menu-footer')
    await expect(footer).toBeVisible()
    const box = (await footer.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(height)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
  }
})

test('hovering moves the highlight, and Enter picks the hovered item', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Hover')
  await page.keyboard.type('/')
  await page.keyboard.press('ArrowDown')
  await page.locator('.slash-menu').getByRole('option', { name: 'Heading 2', exact: true }).hover()
  const active = page.locator('.slash-menu .menu-item.active')
  await expect(active).toHaveCount(1)
  await expect(active).toHaveText(/Heading 2/)
  await page.keyboard.press('ArrowDown')
  await expect(active).toHaveText(/Heading 3/)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Picked')
  await waitForFile(join(nb.workspace, 'Hover.md'), '### Picked')
})

test('the highlight survives the app updating while the menu is open', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Steady')
  await page.keyboard.type('/')
  await page.locator('.slash-menu').getByRole('option', { name: 'Heading 3', exact: true }).hover()
  // A new page re-renders the editor, which hands BlockNote a fresh item loader.
  await writeFile(join(nb.workspace, 'Arrived.md'), 'new\n')
  await expect(page.getByTestId('sidebar-row-Arrived')).toBeVisible()
  await page.waitForTimeout(300)
  await expect(page.locator('.slash-menu .menu-item.active')).toHaveText(/Heading 3/)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Kept')
  await waitForFile(join(nb.workspace, 'Steady.md'), '### Kept')
})
