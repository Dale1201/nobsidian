import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test, type AppFixture } from './fixtures'

async function nestedWorkspace(nb: AppFixture): Promise<Page> {
  await mkdir(join(nb.workspace, 'Top', 'Middle'), { recursive: true })
  await writeFile(join(nb.workspace, 'Top.md'), 'top\n')
  await writeFile(join(nb.workspace, 'Top', 'Middle.md'), 'middle\n')
  await writeFile(join(nb.workspace, 'Top', 'Middle', 'Deep.md'), 'deep\n')
  await writeFile(join(nb.workspace, 'Linker.md'), '[Deep](Top/Middle/Deep.md "page")\n')
  const page = await nb.relaunch()
  await expect(page.getByTestId('sidebar-row-Top')).toBeVisible()
  return page
}

async function search(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Search' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Search' })
  await dialog.getByRole('textbox').fill(text)
  await expect(dialog.locator('.search-item-title').first()).toHaveText(text)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('page-title')).toHaveText(text)
}

async function menuCommand(nb: AppFixture, label: string): Promise<void> {
  await nb.app.evaluate(
    ({ Menu }, label) =>
      Menu.getApplicationMenu()
        ?.items.flatMap((i) => i.submenu?.items ?? [])
        .find((i) => i.label === label)
        ?.click(),
    label
  )
}

test('opening a nested page from search reveals and highlights it', async ({ nb }) => {
  const page = await nestedWorkspace(nb)
  await expect(page.getByTestId('sidebar-row-Deep')).toBeHidden()
  await search(page, 'Deep')
  await expect(page.getByTestId('sidebar-row-Middle')).toBeVisible()
  await expect(page.getByTestId('sidebar-row-Deep')).toHaveClass(/active/)
})

test('following a link reveals the page', async ({ nb }) => {
  const page = await nestedWorkspace(nb)
  await page.getByTestId('sidebar-row-Linker').click()
  await page.locator('.nb-page-link').click()
  await expect(page.getByTestId('sidebar-row-Deep')).toHaveClass(/active/)
})

test('Back reveals the previous page again after its parent was collapsed', async ({ nb }) => {
  const page = await nestedWorkspace(nb)
  await search(page, 'Deep')
  await expect(page.getByTestId('sidebar-row-Deep')).toBeVisible()
  await page.getByTestId('sidebar-row-Linker').click()
  const top = page.getByTestId('sidebar-row-Top')
  await top.hover()
  await top.getByRole('button', { name: 'Collapse' }).click()
  await expect(page.getByTestId('sidebar-row-Deep')).toBeHidden()
  await menuCommand(nb, 'Back')
  await expect(page.getByTestId('sidebar-row-Deep')).toHaveClass(/active/)
})

test('the current row scrolls into view', async ({ nb }) => {
  for (let i = 0; i < 40; i++) {
    await writeFile(join(nb.workspace, `Page ${String(i).padStart(2, '0')}.md`), 'x\n')
  }
  await mkdir(join(nb.workspace, 'Zzz'))
  await writeFile(join(nb.workspace, 'Zzz.md'), 'z\n')
  await writeFile(join(nb.workspace, 'Zzz', 'Target.md'), 'target\n')
  const page = await nb.relaunch()
  await expect(page.getByTestId('sidebar-row-Zzz')).toBeAttached()
  await search(page, 'Target')
  await expect(page.getByTestId('sidebar-row-Target')).toBeInViewport()
})

test('favorites expand on their own', async ({ nb }) => {
  await mkdir(join(nb.workspace, 'Starred'))
  await writeFile(join(nb.workspace, 'Starred.md'), 's\n')
  await writeFile(join(nb.workspace, 'Starred', 'Child.md'), 'c\n')
  const page = await nb.relaunch()
  const pagesRow = page.getByTestId('sidebar-row-Starred')
  await pagesRow.hover()
  await pagesRow.getByRole('button', { name: 'Page actions' }).click()
  await page.getByRole('menuitem', { name: 'Add to Favorites' }).click()
  const favorites = page.locator('.sidebar-section', { hasText: 'Favorites' })
  const favRow = favorites.getByTestId('sidebar-row-Starred')
  await favRow.hover()
  await favRow.getByRole('button', { name: 'Expand' }).click()
  await expect(favorites.getByTestId('sidebar-row-Child')).toBeVisible()
  const pages = page.locator('.sidebar-section', { hasText: 'Pages' })
  await expect(pages.getByTestId('sidebar-row-Child')).toBeHidden()
})

test('a page without sub-pages says so when expanded', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Leaf.md'), 'l\n')
  const page = await nb.relaunch()
  const row = page.getByTestId('sidebar-row-Leaf')
  await row.hover()
  await row.getByRole('button', { name: 'Expand' }).click()
  await expect(page.locator('.sidebar-empty')).toHaveText('No pages inside')
})

test('holding a dragged page over a collapsed page opens it, and dropping nests it', async ({
  nb
}) => {
  await mkdir(join(nb.workspace, 'Folder'))
  await writeFile(join(nb.workspace, 'Folder.md'), 'f\n')
  await writeFile(join(nb.workspace, 'Folder', 'Inside.md'), 'i\n')
  await writeFile(join(nb.workspace, 'Mover.md'), 'm\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Mover').hover()
  await page.mouse.down()
  const box = (await page.getByTestId('sidebar-row-Folder').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y, { steps: 5 })
  await page.waitForTimeout(700)
  await page.mouse.move(x + 2, y, { steps: 2 })
  await expect(page.getByTestId('sidebar-row-Inside')).toBeVisible()
  await page.mouse.up()
  await expect
    .poll(() =>
      access(join(nb.workspace, 'Folder', 'Mover.md')).then(
        () => true,
        () => false
      )
    )
    .toBe(true)
})

test('the sidebar scrolls while a page is dragged near its bottom edge', async ({ nb }) => {
  for (let i = 0; i < 40; i++) {
    await writeFile(join(nb.workspace, `Page ${String(i).padStart(2, '0')}.md`), 'x\n')
  }
  const page = await nb.relaunch()
  const scroller = page.locator('.sidebar-scroll')
  await expect(page.getByTestId('sidebar-row-Page 00')).toBeVisible()
  await page.getByTestId('sidebar-row-Page 00').hover()
  await page.mouse.down()
  const box = (await scroller.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 10, { steps: 5 })
  for (let i = 0; i < 10; i++)
    await page.mouse.move(box.x + box.width / 2 + (i % 2), box.y + box.height - 10)
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await page.mouse.up()
})

test('starring the current page does not move the sidebar', async ({ nb }) => {
  for (let i = 0; i < 40; i++) {
    await writeFile(join(nb.workspace, `Page ${String(i).padStart(2, '0')}.md`), 'x\n')
  }
  const page = await nb.relaunch()
  const scroller = page.locator('.sidebar-scroll')
  await expect(page.getByTestId('sidebar-row-Page 39')).toBeAttached()
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight))
  await page.getByTestId('sidebar-row-Page 39').click()
  await expect(page.getByTestId('page-title')).toHaveText('Page 39')
  const row = page
    .locator('.sidebar-section', { hasText: 'Pages' })
    .getByTestId('sidebar-row-Page 39')
  const before = (await row.boundingBox())!.y
  await page.getByRole('button', { name: 'Add to Favorites' }).click()
  await expect(page.locator('.sidebar-section', { hasText: 'Favorites' })).toBeAttached()
  await page.waitForTimeout(300)
  // Scroll anchoring may raise scrollTop by the new section's height; the row itself stays put.
  expect(Math.abs((await row.boundingBox())!.y - before)).toBeLessThanOrEqual(1)
})

test('clicking a favorite of a nested page keeps the favorite in view', async ({ nb }) => {
  for (let i = 0; i < 40; i++) {
    await writeFile(join(nb.workspace, `Page ${String(i).padStart(2, '0')}.md`), 'x\n')
  }
  await mkdir(join(nb.workspace, 'Zzz'))
  await writeFile(join(nb.workspace, 'Zzz.md'), 'z\n')
  await writeFile(join(nb.workspace, 'Zzz', 'Target.md'), 'target\n')
  const page = await nb.relaunch()
  await expect(page.getByTestId('sidebar-row-Zzz')).toBeAttached()
  await search(page, 'Target')
  await page.getByRole('button', { name: 'Add to Favorites' }).click()
  const zzz = page.locator('.sidebar-section', { hasText: 'Pages' }).getByTestId('sidebar-row-Zzz')
  await zzz.hover()
  await zzz.getByRole('button', { name: 'Collapse' }).click()
  await page.getByTestId('sidebar-row-Page 00').click()
  await page.locator('.sidebar-scroll').evaluate((el) => (el.scrollTop = 0))
  const favorite = page
    .locator('.sidebar-section', { hasText: 'Favorites' })
    .getByTestId('sidebar-row-Target')
  await favorite.click()
  await expect(page.getByTestId('page-title')).toHaveText('Target')
  await page.waitForTimeout(300)
  await expect(favorite).toBeInViewport()
})

test('+ on a favorite adds the page inside the favorite', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'Starred.md'), 's\n')
  const page = await nb.relaunch()
  const pagesRow = page.getByTestId('sidebar-row-Starred')
  await pagesRow.hover()
  await pagesRow.getByRole('button', { name: 'Page actions' }).click()
  await page.getByRole('menuitem', { name: 'Add to Favorites' }).click()
  const favorites = page.locator('.sidebar-section', { hasText: 'Favorites' })
  const favRow = favorites.getByTestId('sidebar-row-Starred')
  await favRow.hover()
  await favRow.getByRole('button', { name: 'Add a page inside' }).click()
  await expect(favorites.getByTestId('sidebar-row-Untitled')).toBeVisible()
})

test('searching for the page you are on reveals it again', async ({ nb }) => {
  const page = await nestedWorkspace(nb)
  await search(page, 'Deep')
  const top = page.getByTestId('sidebar-row-Top')
  await top.hover()
  await top.getByRole('button', { name: 'Collapse' }).click()
  await expect(page.getByTestId('sidebar-row-Deep')).toBeHidden()
  await search(page, 'Deep')
  await expect(page.getByTestId('sidebar-row-Deep')).toHaveClass(/active/)
})
