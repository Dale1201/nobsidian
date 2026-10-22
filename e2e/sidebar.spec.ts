import { mkdir, writeFile } from 'node:fs/promises'
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
