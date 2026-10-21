import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, type Page } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { expect, test } from './fixtures'

const editor = '.bn-editor'

/** Waits until the freshly created page is showing, so typing can't land in the previous one. */
async function typeNewPageTitle(page: Page, title: string): Promise<void> {
  const heading = page.getByTestId('page-title')
  await expect(heading).toHaveText('')
  await expect(heading).toBeFocused()
  await page.keyboard.type(title)
}

async function waitForFile(path: string, match: RegExp | string): Promise<string> {
  let text = ''
  await expect
    .poll(async () => {
      text = await readFile(path, 'utf8').catch(() => '')
      return typeof match === 'string' ? text.includes(match) : match.test(text)
    })
    .toBe(true)
  return text
}

test('first run asks for a folder and creates the first page', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-user-'))
  const folder = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-ws-'))
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page.getByText('Welcome to Nobsidian')).toBeVisible()
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [dir]
    })) as typeof dialog.showOpenDialog
  }, folder)
  await page.getByRole('button', { name: 'Choose a folder' }).click()
  await expect(page.getByTestId('sidebar-row-Untitled')).toBeVisible()
  expect(await readdir(folder)).toContain('Untitled.md')
  await app.close()
})

test('a missing notes folder is reported, not recreated', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-user-'))
  const gone = join(userData, 'Moved Notes')
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ lastWorkspace: gone }))
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page.getByText("Can't find your notes")).toBeVisible()
  await expect(page.getByText(gone)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Locate folder' })).toBeVisible()
  await expect(readdir(gone)).rejects.toThrow()
  await app.close()
})

test('remembers the window size', async ({ nb }) => {
  await nb.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 60, width: 1000, height: 700 })
  )
  await nb.relaunch()
  const bounds = await nb.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds()
  )
  expect(bounds).toMatchObject({ width: 1000, height: 700 })
})

test('writing a page saves Markdown to disk', async ({ nb }) => {
  const { page, workspace } = nb
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Meeting notes')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('sidebar-row-Meeting notes')).toBeVisible()
  await page.keyboard.type('# Agenda')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- first item')
  await page.keyboard.press('Enter')
  await page.keyboard.type('second item')
  const text = await waitForFile(join(workspace, 'Meeting notes.md'), 'second item')
  expect(text).toMatch(/# Agenda\n\n- first item\n- second item\n/)
})

test('slash menu inserts a callout and a sub-page', async ({ nb }) => {
  const { page, workspace } = nb
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Parent')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/callout')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Remember this')
  await waitForFile(join(workspace, 'Parent.md'), '> [!callout] 💡\n> Remember this')
  await page.locator(editor).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/page')
  await page.keyboard.press('Enter')
  await waitForFile(join(workspace, 'Parent.md'), '(Parent/Untitled.md "page")')
  await expect(page.locator('.nb-page-link')).toHaveText(/Untitled/)
  await page.locator('.nb-page-link').click()
  await expect(page.locator('.breadcrumbs')).toHaveText(/Parent\s*\/\s*Untitled/)
})

test('renaming a parent moves its folder and keeps links working', async ({ nb }) => {
  const { page, workspace } = nb
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Projects')
  await page.getByTestId('sidebar-row-Projects').hover()
  await page
    .getByTestId('sidebar-row-Projects')
    .getByRole('button', { name: 'Add a page inside' })
    .click()
  await typeNewPageTitle(page, 'Website')
  await expect(page.getByTestId('sidebar-row-Website')).toBeVisible()
  await expect
    .poll(() => readdir(join(workspace, 'Projects')).catch(() => []))
    .toEqual(['Website.md'])
  await page.getByTestId('sidebar-row-Projects').click()
  await page.getByTestId('page-title').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 2026')
  await expect(page.getByTestId('sidebar-row-Projects 2026')).toBeVisible()
  await expect
    .poll(() => readdir(join(workspace, 'Projects 2026')).catch(() => []))
    .toEqual(['Website.md'])
})

test('favorites, delete and dark mode', async ({ nb }) => {
  const { page, workspace } = nb
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Keep')
  await page.getByRole('button', { name: 'Add to Favorites' }).click()
  await expect(page.locator('.sidebar-section-title', { hasText: 'Favorites' })).toBeVisible()
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Remove me')
  await expect(page.getByTestId('sidebar-row-Remove me')).toBeVisible()
  await page.getByRole('button', { name: 'Page menu' }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('sidebar-row-Remove me')).toHaveCount(0)
  expect(await readdir(join(workspace, '.nobsidian', 'trash'))).toHaveLength(1)

  await nb.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById?.('x')
    const item = Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Toggle Dark Mode')
    item?.click()
  })
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/)
  const before = await page.locator('html').getAttribute('data-theme')
  await nb.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Toggle Dark Mode')
      ?.click()
  })
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '')
})

test('edits survive a restart, including the last open page', async ({ nb }) => {
  let page = nb.page
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Journal')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Dear diary')
  page = await nb.relaunch()
  await expect(page.getByTestId('page-title')).toHaveText('Journal')
  await expect(page.locator(editor)).toContainText('Dear diary')
})

test('page icon from the emoji picker and an uploaded cover', async ({ nb }) => {
  const { page, workspace, app } = nb
  await page.getByRole('button', { name: 'New page' }).first().click()
  await typeNewPageTitle(page, 'Trip')
  await page.getByTestId('page-title').hover()
  await page.getByRole('button', { name: 'Add icon' }).click()
  await page.getByTestId('page-icon').click()
  await page.getByPlaceholder('Filter…').fill('airplane')
  await page.locator('.nb-icon-picker-emoji', { hasText: '✈️' }).click()
  await expect(page.getByTestId('page-icon')).toHaveText('✈️')
  await waitForFile(join(workspace, 'Trip.md'), 'icon: ✈️')

  const image = join(workspace, '..', `cover-${Date.now()}.png`)
  await writeFile(
    image,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [file]
    })) as typeof dialog.showOpenDialog
  }, image)
  await page.getByTestId('page-title').hover()
  await page.getByRole('button', { name: 'Add cover' }).click()
  await expect(page.getByTestId('page-cover').locator('img')).toHaveJSProperty('naturalWidth', 1)
  await waitForFile(join(workspace, 'Trip.md'), /cover: attachments\/cover-\d+\.png/)
})
