import { mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { editor, rowAction, waitForFile } from './helpers'

/** Clicks an application menu item by label, hidden ones included, as its accelerator would. */
async function menu(app: ElectronApplication, label: string): Promise<void> {
  const found = await app.evaluate(({ Menu }, label) => {
    const walk = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.label === label) return item
        const inner = item.submenu && walk(item.submenu.items)
        if (inner) return inner
      }
      return undefined
    }
    const item = walk(Menu.getApplicationMenu()?.items ?? [])
    item?.click()
    return Boolean(item)
  }, label)
  expect(found, `menu item ${label}`).toBe(true)
}

const pane = (page: Page): Locator => page.locator('.tab-pane.active')
const tabTitles = (page: Page): Promise<(string | null)[]> =>
  page.locator('.tab').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const activeTitle = (page: Page): Promise<string | null> =>
  page.locator('.tab.active').getAttribute('aria-label')

async function pages(
  nb: { workspace: string; relaunch: () => Promise<Page> },
  files: Record<string, string>
): Promise<Page> {
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(nb.workspace, `${name}.md`), body)
  }
  return nb.relaunch()
}

async function open(page: Page, title: string): Promise<void> {
  await page.getByTestId(`sidebar-row-${title}`).click()
  await expect(pane(page).getByTestId('page-title')).toHaveText(title)
}

/** Opens a page in a new tab without modifier clicks: a new tab, then the page in it. */
async function tabOn(app: ElectronApplication, page: Page, title: string): Promise<void> {
  await menu(app, 'New Tab')
  await open(page, title)
}

const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n') + '\n'

/** The page's frontmatter, so an outside edit keeps its id like a real editor would. */
async function header(file: string): Promise<string> {
  return /^---\n[\s\S]*?\n---\n/.exec(await readFile(file, 'utf8'))![0]
}

test('Cmd+T and + open the current page in a new tab right after it', async ({ nb }) => {
  const page = await pages(nb, { Alpha: 'A.\n', Beta: 'B.\n' })
  await open(page, 'Alpha')
  await menu(nb.app, 'New Tab')
  expect(await tabTitles(page)).toEqual(['Alpha', 'Alpha'])
  await expect(page.locator('.tab').nth(1)).toHaveClass(/active/)
  await open(page, 'Beta')
  await page.locator('.tab').first().click()
  await page.getByRole('button', { name: 'New tab' }).click()
  expect(await tabTitles(page)).toEqual(['Alpha', 'Alpha', 'Beta'])
  expect(await activeTitle(page)).toBe('Alpha')
  await expect(page.locator('.tab').nth(1)).toHaveClass(/active/)
})

test('closing tabs hands over to a neighbour, and closing the last one closes the window', async ({
  nb
}) => {
  const page = await pages(nb, { One: '1\n', Two: '2\n', Three: '3\n' })
  await open(page, 'One')
  await tabOn(nb.app, page, 'Two')
  await tabOn(nb.app, page, 'Three')
  await page.getByTestId('tab-Two').click({ button: 'middle' })
  expect(await tabTitles(page)).toEqual(['One', 'Three'])
  await page.getByTestId('tab-One').hover()
  await page.getByRole('button', { name: 'Close One' }).click()
  expect(await tabTitles(page)).toEqual(['Three'])
  await expect(pane(page).getByTestId('page-title')).toHaveText('Three')
  await menu(nb.app, 'Close Tab')
  await expect
    .poll(() => nb.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(0)
})

test('the tab shortcuts switch tabs', async ({ nb }) => {
  const page = await pages(nb, { One: '1\n', Two: '2\n', Three: '3\n' })
  await open(page, 'One')
  await tabOn(nb.app, page, 'Two')
  await tabOn(nb.app, page, 'Three')
  const accelerators = await nb.app.evaluate(({ Menu }) => {
    const out: Record<string, string> = {}
    const walk = (items: Electron.MenuItem[]): void => {
      for (const item of items) {
        if (item.accelerator) out[item.label] = item.accelerator
        if (item.submenu) walk(item.submenu.items)
      }
    }
    walk(Menu.getApplicationMenu()?.items ?? [])
    return out
  })
  expect(accelerators).toMatchObject({
    'New Tab': 'CmdOrCtrl+T',
    'Close Tab': 'CmdOrCtrl+W',
    'Close Window': 'CmdOrCtrl+Shift+W',
    'Reopen Closed Tab': 'CmdOrCtrl+Shift+T',
    'Show Next Tab': 'Ctrl+Tab',
    'Show Previous Tab': 'Ctrl+Shift+Tab',
    'Select Tab 1': 'CmdOrCtrl+1',
    'Select Last Tab': 'CmdOrCtrl+9'
  })
  await menu(nb.app, 'Show Next Tab')
  expect(await activeTitle(page)).toBe('One')
  await menu(nb.app, 'Alt+CmdOrCtrl+Right')
  expect(await activeTitle(page)).toBe('Two')
  await menu(nb.app, 'CmdOrCtrl+Shift+[')
  expect(await activeTitle(page)).toBe('One')
  await menu(nb.app, 'Show Previous Tab')
  expect(await activeTitle(page)).toBe('Three')
  await menu(nb.app, 'Select Tab 2')
  expect(await activeTitle(page)).toBe('Two')
  await menu(nb.app, 'Select Last Tab')
  expect(await activeTitle(page)).toBe('Three')
})

test('each tab keeps its own back and forward, with scroll positions', async ({ nb }) => {
  const page = await pages(nb, { Long: long, Short: 'Short.\n' })
  await open(page, 'Long')
  await pane(page)
    .getByTestId('page-scroll')
    .evaluate((el) => (el.scrollTop = 700))
  await open(page, 'Short')
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(pane(page).getByTestId('page-title')).toHaveText('Long')
  await expect
    .poll(() =>
      pane(page)
        .getByTestId('page-scroll')
        .evaluate((el) => el.scrollTop)
    )
    .toBe(700)
  await expect(page.getByRole('button', { name: 'Forward' })).toBeEnabled()
  await menu(nb.app, 'New Tab')
  await expect(pane(page).getByTestId('page-title')).toHaveText('Long')
  await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Forward' })).toBeDisabled()
  await page.locator('.tab').first().click()
  await page.getByRole('button', { name: 'Forward' }).click()
  await expect(pane(page).getByTestId('page-title')).toHaveText('Short')
})

test('a tab left and come back to keeps its scroll and its undo history', async ({ nb }) => {
  const page = await pages(nb, { Long: long, Other: 'Other.\n' })
  await open(page, 'Long')
  await pane(page).locator(editor).getByText('Paragraph 3.').click()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type(' typed')
  await pane(page)
    .getByTestId('page-scroll')
    .evaluate((el) => (el.scrollTop = 500))
  await tabOn(nb.app, page, 'Other')
  await waitForFile(join(nb.workspace, 'Long.md'), 'Paragraph 3. typed')
  await page.getByTestId('tab-Long').click()
  expect(
    await pane(page)
      .getByTestId('page-scroll')
      .evaluate((el) => el.scrollTop)
  ).toBe(500)
  await pane(page).locator(editor).getByText('Paragraph 3. typed').click()
  await page.keyboard.press('Meta+Z')
  await expect(pane(page).locator(editor)).not.toContainText('typed')
})

test('a renamed page renames its tabs', async ({ nb }) => {
  const page = await pages(nb, { Draft: 'Text.\n', Other: 'Other.\n' })
  await open(page, 'Draft')
  await tabOn(nb.app, page, 'Other')
  await rowAction(page, 'Draft', 'Rename')
  await page.keyboard.press('Meta+A')
  await page.keyboard.type('Final')
  await page.keyboard.press('Enter')
  expect(await tabTitles(page)).toEqual(['Final', 'Other'])
  const file = join(nb.workspace, 'Other.md')
  const text = await readFile(file, 'utf8')
  await writeFile(file, text.replace('---\n', '---\nicon: 🌿\n'))
  await expect(page.getByTestId('tab-Other').locator('.tab-icon')).toHaveText('🌿')
})

test('a deleted page shows the Trash banner in its tabs and comes back when restored', async ({
  nb
}) => {
  const page = await pages(nb, { Doomed: 'Keep me.\n', Other: 'Other.\n' })
  await open(page, 'Doomed')
  await menu(nb.app, 'New Tab')
  await rowAction(page, 'Doomed', 'Delete')
  await expect(pane(page).getByRole('status')).toContainText('This page is in Trash.')
  expect(await tabTitles(page)).toEqual(['Doomed', 'Doomed'])
  await page.locator('.tab').first().click()
  await expect(pane(page).getByRole('status')).toContainText('This page is in Trash.')
  await pane(page).getByRole('button', { name: 'Restore page' }).click()
  await expect(pane(page).locator(editor)).toContainText('Keep me.')
  await page.locator('.tab').nth(1).click()
  await expect(pane(page).locator(editor)).toContainText('Keep me.')
})

test('a page deleted outside the app sends its tab back to the previous page', async ({ nb }) => {
  const page = await pages(nb, { First: '1\n', Second: '2\n' })
  await open(page, 'First')
  await open(page, 'Second')
  await unlink(join(nb.workspace, 'Second.md'))
  await expect(pane(page).getByTestId('page-title')).toHaveText('First')
  expect(await tabTitles(page)).toEqual(['First'])
})

test('an outside edit reloads a hidden tab quietly', async ({ nb }) => {
  const page = await pages(nb, { Shown: 'Shown.\n', Hidden: 'Before.\n' })
  await open(page, 'Hidden')
  await tabOn(nb.app, page, 'Shown')
  const file = join(nb.workspace, 'Hidden.md')
  await writeFile(file, `${await header(file)}\nAfter.\n`)
  await page.waitForTimeout(500)
  await page.getByTestId('tab-Hidden').click()
  await expect(pane(page).locator(editor)).toHaveText('After.')
  await expect(pane(page).getByRole('status')).toHaveCount(0)
})

test('closing a tab saves what was typed in it', async ({ nb }) => {
  const page = await pages(nb, { Alpha: 'A.\n', Beta: 'B.\n' })
  await open(page, 'Alpha')
  await tabOn(nb.app, page, 'Beta')
  await pane(page).locator(editor).getByText('B.').click()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type(' Last words.')
  await menu(nb.app, 'Close Tab')
  expect(await tabTitles(page)).toEqual(['Alpha'])
  await waitForFile(join(nb.workspace, 'Beta.md'), 'B. Last words.')
})

test('tabs come back after a relaunch, for each notes folder', async ({ nb }) => {
  let page = await pages(nb, { One: '1\n', Two: '2\n', Three: '3\n' })
  await open(page, 'One')
  await open(page, 'Two')
  await tabOn(nb.app, page, 'Three')
  page = await nb.relaunch()
  await expect.poll(() => tabTitles(page)).toEqual(['Two', 'Three'])
  expect(await activeTitle(page)).toBe('Three')
  await page.getByTestId('tab-Two').click()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(pane(page).getByTestId('page-title')).toHaveText('One')

  const other = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-ws-'))
  // With an id the page is known at once, instead of after new files settle.
  await writeFile(
    join(other, 'Elsewhere.md'),
    '---\nid: 33333333-3333-4333-8333-333333333333\n---\n\nElsewhere.\n'
  )
  await nb.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [dir]
    })) as typeof dialog.showOpenDialog
  }, other)
  await page.locator('.sidebar-workspace').click()
  await page.getByText('Open another folder…').click()
  await expect.poll(() => tabTitles(page)).toEqual(['Elsewhere'])
  await nb.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [dir]
    })) as typeof dialog.showOpenDialog
  }, nb.workspace)
  await page.locator('.sidebar-workspace').click()
  await page.getByText('Open another folder…').click()
  await expect.poll(() => tabTitles(page)).toEqual(['One', 'Three'])
})
test('closing the last tab saves what was typed before the window closes', async ({ nb }) => {
  const page = await pages(nb, { Alpha: 'A.\n' })
  await open(page, 'Alpha')
  await pane(page).locator(editor).getByText('A.').click()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type(' Final words.')
  await menu(nb.app, 'Close Tab')
  await waitForFile(join(nb.workspace, 'Alpha.md'), 'A. Final words.')
  await expect
    .poll(() => nb.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(0)
})

test('a file dropped on a page is attached to the visible tab only', async ({ nb }) => {
  const page = await pages(nb, { Alpha: 'A.\n', Beta: 'B.\n' })
  await open(page, 'Alpha')
  await tabOn(nb.app, page, 'Beta')
  // A zip named like a Notion export, dropped in a page, is attached once it turns out not to be one.
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([new Uint8Array([80, 75, 5, 6])], 'Export-1.zip', { type: 'application/zip' })
    )
    document
      .querySelector('.tab-pane.active .bn-editor')!
      .dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
      )
  })
  await expect(pane(page).locator(editor).getByText('Export-1.zip')).toBeVisible()
  await page.getByTestId('tab-Alpha').click()
  await expect(pane(page).locator(editor)).toHaveText('A.')
})

test('the active tab stays in view when the tabs do not fit', async ({ nb }) => {
  const page = await pages(nb, { Alpha: 'A.\n' })
  await open(page, 'Alpha')
  for (let i = 0; i < 30; i++) await menu(nb.app, 'New Tab')
  await expect(page.locator('.tab')).toHaveCount(31)
  const inView = async (): Promise<boolean> => {
    const list = (await page.locator('.tab-list').boundingBox())!
    const tab = (await page.locator('.tab.active').boundingBox())!
    return tab.x >= list.x - 0.5 && tab.x + tab.width <= list.x + list.width + 0.5
  }
  expect((await page.locator('.tab.active').boundingBox())!.width).toBe(36)
  await expect.poll(inView).toBe(true)
  await menu(nb.app, 'Select Tab 1')
  await expect.poll(inView).toBe(true)
  await menu(nb.app, 'Select Last Tab')
  await expect.poll(inView).toBe(true)
})

test('Cmd-click and middle-click open background tabs in a row; Cmd+Shift-click opens in front', async ({
  nb
}) => {
  const page = await pages(nb, { One: '1\n', Two: '2\n', Three: '3\n', Four: '4\n' })
  await open(page, 'One')
  await page.getByTestId('sidebar-row-Two').click({ modifiers: ['Meta'] })
  await page.getByTestId('sidebar-row-Three').click({ button: 'middle' })
  expect(await tabTitles(page)).toEqual(['One', 'Two', 'Three'])
  expect(await activeTitle(page)).toBe('One')
  await expect(pane(page).getByTestId('page-title')).toHaveText('One')
  await page.getByTestId('sidebar-row-Four').click({ modifiers: ['Meta', 'Shift'] })
  expect(await tabTitles(page)).toEqual(['One', 'Two', 'Three', 'Four'])
  expect(await activeTitle(page)).toBe('Four')
  await expect(pane(page).getByTestId('page-title')).toHaveText('Four')
})

test('links and mentions in a page open in a background tab with Cmd or the middle button', async ({
  nb
}) => {
  const page = await pages(nb, {
    Hub: 'Read [the plan](Plan.md) and [Notes](Notes.md "mention").\n',
    Plan: 'Plan.\n',
    Notes: 'Notes.\n'
  })
  await open(page, 'Hub')
  await pane(page)
    .locator(editor)
    .getByRole('link', { name: 'the plan' })
    .click({ modifiers: ['Meta'] })
  await pane(page).locator('.nb-mention').click({ button: 'middle' })
  expect(await tabTitles(page)).toEqual(['Hub', 'Plan', 'Notes'])
  expect(await activeTitle(page)).toBe('Hub')
  // A plain click still opens the page in the tab it is in.
  await pane(page).locator('.nb-mention').click()
  await expect.poll(() => tabTitles(page)).toEqual(['Notes', 'Plan', 'Notes'])
})

test('Cmd+Enter in Search opens the result in a background tab', async ({ nb }) => {
  const page = await pages(nb, { Alpha: 'A.\n', Beta: 'Findable words.\n' })
  await open(page, 'Alpha')
  await page.keyboard.press('Meta+K')
  await page.getByPlaceholder(/^Search/).fill('Findable')
  await expect(page.locator('.search-item')).toHaveCount(1)
  await page.keyboard.press('Meta+Enter')
  expect(await tabTitles(page)).toEqual(['Alpha', 'Beta'])
  expect(await activeTitle(page)).toBe('Alpha')
})

test('Reopen Closed Tab brings back a closed tab, and a batch closed together', async ({ nb }) => {
  const page = await pages(nb, { One: '1\n', Two: '2\n', Three: '3\n' })
  await open(page, 'One')
  await page.getByTestId('sidebar-row-Two').click({ modifiers: ['Meta'] })
  await page.getByTestId('sidebar-row-Three').click({ modifiers: ['Meta'] })
  await page.getByTestId('tab-Two').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Close Other Tabs' }).click()
  expect(await tabTitles(page)).toEqual(['Two'])
  await menu(nb.app, 'Reopen Closed Tab')
  expect(await tabTitles(page)).toEqual(['One', 'Two', 'Three'])

  await page.getByTestId('tab-Three').click({ button: 'middle' })
  await page.getByTestId('tab-One').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Reopen Closed Tab' }).click()
  expect(await tabTitles(page)).toEqual(['One', 'Two', 'Three'])
  expect(await activeTitle(page)).toBe('Three')
})

test('the tab menu disables what would do nothing', async ({ nb }) => {
  const page = await pages(nb, { One: '1\n', Two: '2\n' })
  await open(page, 'One')
  await page.getByTestId('tab-One').click({ button: 'right' })
  for (const label of ['Reopen Closed Tab', 'Close Other Tabs', 'Close Tabs to the Left']) {
    await expect(page.getByRole('menuitem', { name: label })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  }
  await page.getByRole('menuitem', { name: 'Duplicate Tab' }).click()
  expect(await tabTitles(page)).toEqual(['One', 'One'])
})

test('dragging a tab moves it', async ({ nb }) => {
  const page = await pages(nb, { One: '1\n', Two: '2\n', Three: '3\n' })
  await open(page, 'One')
  await page.getByTestId('sidebar-row-Two').click({ modifiers: ['Meta'] })
  await page.getByTestId('sidebar-row-Three').click({ modifiers: ['Meta'] })
  const one = await page.getByTestId('tab-One').boundingBox()
  const three = await page.getByTestId('tab-Three').boundingBox()
  await page.mouse.move(one!.x + 20, one!.y + 18)
  await page.mouse.down()
  await page.mouse.move(one!.x + 40, one!.y + 18, { steps: 4 })
  await expect(page.locator('.tab-drop-line')).toBeVisible()
  await page.mouse.move(three!.x + three!.width - 10, three!.y + 18, { steps: 8 })
  await page.mouse.up()
  expect(await tabTitles(page)).toEqual(['Two', 'Three', 'One'])
  expect(await activeTitle(page)).toBe('One')
  await expect(page.locator('.tab-drop-line')).toHaveCount(0)
})

test('a hidden tab whose page is in conflict shows a dot until it is looked at', async ({ nb }) => {
  const page = await pages(nb, { Shared: 'Base\n', Other: 'Other.\n' })
  await open(page, 'Shared')
  const file = join(nb.workspace, 'Shared.md')
  const head = await header(file)
  await pane(page).locator(editor).getByText('Base').click()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type(' plus mine')
  await writeFile(file, `${head}\nTheirs\n`)
  await expect(pane(page).getByRole('status')).toContainText('changed outside Nobsidian')
  await page.getByTestId('sidebar-row-Other').click({ modifiers: ['Meta', 'Shift'] })
  await expect(page.getByTestId('tab-Shared').locator('.tab-conflict')).toBeVisible()
  await page.getByTestId('tab-Shared').click()
  await expect(pane(page).getByRole('status')).toContainText('changed outside Nobsidian')
  await expect(page.locator('.tab-conflict')).toHaveCount(0)
  await expect(pane(page).locator(editor)).toHaveText('Base plus mine')
})

test('typing in one tab updates the same page in another', async ({ nb }) => {
  const page = await pages(nb, { Shared: 'Start.\n' })
  await open(page, 'Shared')
  await menu(nb.app, 'New Tab')
  await pane(page).locator(editor).getByText('Start.').click()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type(' More.')
  await waitForFile(join(nb.workspace, 'Shared.md'), 'Start. More.')
  await page.locator('.tab').first().click()
  await expect(pane(page).locator(editor)).toHaveText('Start. More.')
  await expect(pane(page).getByRole('status')).toHaveCount(0)
})

// Found by the whole-branch review.

test('a page open in two tabs keeps one history version and the other tab in place while typing', async ({
  nb
}) => {
  const page = await pages(nb, { Shared: 'Start.\n' })
  await open(page, 'Shared')
  await menu(nb.app, 'New Tab')
  await pane(page).locator(editor).getByText('Start.').click()
  await page.keyboard.press('Meta+ArrowRight')
  for (const word of [' one', ' two', ' three', ' four', ' five']) {
    await page.keyboard.type(word)
    await page.waitForTimeout(800)
  }
  const file = join(nb.workspace, 'Shared.md')
  await waitForFile(file, 'Start. one two three four five')
  const id = /id: (\S+)/.exec(await readFile(file, 'utf8'))![1]
  const versions = await readdir(join(nb.workspace, '.nobsidian', 'history', id)).catch(() => [])
  expect(versions.filter((v) => v.endsWith('.md')).length).toBeLessThanOrEqual(1)
  await page.locator('.tab').first().click()
  await expect(pane(page).locator(editor)).toHaveText('Start. one two three four five')
  await pane(page).locator(editor).getByText('Start.', { exact: false }).click()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type(' six')
  await expect(pane(page).locator(editor)).toContainText(' six')
  const text = await pane(page).locator(editor).textContent()
  expect(text!.replace(' six', '')).toBe('Start. one two three four five')
})

test('Cmd+Shift-click on a link in a page opens it in a tab in front', async ({ nb }) => {
  const page = await pages(nb, { Hub: 'Read [the plan](Plan.md).\n', Plan: 'Plan.\n' })
  await open(page, 'Hub')
  await pane(page)
    .locator(editor)
    .getByRole('link', { name: 'the plan' })
    .click({ modifiers: ['Meta', 'Shift'] })
  await expect.poll(() => tabTitles(page)).toEqual(['Hub', 'Plan'])
  expect(await activeTitle(page)).toBe('Plan')
})

test('moving a tab keeps the scroll position of a hidden tab', async ({ nb }) => {
  const page = await pages(nb, { Long: long, Short: 'Short.\n' })
  await open(page, 'Long')
  await pane(page)
    .getByTestId('page-scroll')
    .evaluate((el) => (el.scrollTop = 700))
  await page.getByTestId('sidebar-row-Short').click({ modifiers: ['Meta', 'Shift'] })
  await expect(pane(page).getByTestId('page-title')).toHaveText('Short')
  const short = (await page.getByTestId('tab-Short').boundingBox())!
  const longTab = (await page.getByTestId('tab-Long').boundingBox())!
  await page.mouse.move(short.x + 20, short.y + 18)
  await page.mouse.down()
  await page.mouse.move(short.x - 10, short.y + 18, { steps: 4 })
  await page.mouse.move(longTab.x + 5, longTab.y + 18, { steps: 8 })
  await page.mouse.up()
  expect(await tabTitles(page)).toEqual(['Short', 'Long'])
  await page.getByTestId('tab-Long').click()
  expect(
    await pane(page)
      .getByTestId('page-scroll')
      .evaluate((el) => el.scrollTop)
  ).toBe(700)
})

test('reopening a tab whose page was deleted since shows the Trash banner or steps away', async ({
  nb
}) => {
  const page = await pages(nb, { Keep: 'Keep.\n', Doomed: 'Doomed.\n', Gone: 'Gone.\n' })
  await open(page, 'Keep')
  await tabOn(nb.app, page, 'Doomed')
  await menu(nb.app, 'Close Tab')
  await rowAction(page, 'Doomed', 'Delete')
  await expect(page.getByTestId('sidebar-row-Doomed')).toHaveCount(0)
  await menu(nb.app, 'Reopen Closed Tab')
  await expect.poll(() => tabTitles(page)).toEqual(['Keep', 'Doomed'])
  await expect(pane(page).getByRole('status')).toContainText('This page is in Trash.')

  // Deleted outside the app, it steps back to the page the tab showed before.
  await page.getByTestId('tab-Keep').click()
  await tabOn(nb.app, page, 'Gone')
  await menu(nb.app, 'Close Tab')
  await unlink(join(nb.workspace, 'Gone.md'))
  await expect(page.getByTestId('sidebar-row-Gone')).toHaveCount(0)
  await menu(nb.app, 'Reopen Closed Tab')
  await expect.poll(() => tabTitles(page)).toEqual(['Keep', 'Keep', 'Doomed'])
  await expect(pane(page).getByTestId('page-title')).toHaveText('Keep')
})

test('a tab squeezed to 36px shows only its icon, centred', async ({ nb }) => {
  const page = await pages(nb, { Alpha: '---\nicon: 🚀\n---\n\nA.\n' })
  await open(page, 'Alpha')
  for (let i = 0; i < 30; i++) await menu(nb.app, 'New Tab')
  const tab = (await page.locator('.tab').first().boundingBox())!
  const icon = (await page.locator('.tab').first().locator('.tab-icon').boundingBox())!
  expect(tab.width).toBe(36)
  expect(Math.abs(icon.x + icon.width / 2 - (tab.x + tab.width / 2))).toBeLessThanOrEqual(0.5)
  await expect(page.locator('.tab').first().locator('.tab-title')).toBeHidden()
})

test('Cmd+K opens Search after leaving a tab with selected text', async ({ nb }) => {
  const page = await pages(nb, { Alpha: 'Some words here.\n', Beta: 'B.\n' })
  await open(page, 'Alpha')
  await pane(page).locator(editor).getByText('Some words here.').dblclick()
  await page.getByTestId('sidebar-row-Beta').click({ modifiers: ['Meta', 'Shift'] })
  await expect(pane(page).getByTestId('page-title')).toHaveText('Beta')
  await page.keyboard.press('Meta+K')
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
})

test('coming back to a tab puts the caret back where it was', async ({ nb }) => {
  const page = await pages(nb, { Alpha: 'A.\n', Beta: 'B.\n' })
  await open(page, 'Alpha')
  await tabOn(nb.app, page, 'Beta')
  await page.locator('.tab').first().click()
  await pane(page).locator(editor).getByText('A.').click()
  await page.keyboard.press('Meta+ArrowRight')
  await menu(nb.app, 'Show Next Tab')
  await expect(pane(page).getByTestId('page-title')).toHaveText('Beta')
  await menu(nb.app, 'Show Previous Tab')
  await expect(pane(page).getByTestId('page-title')).toHaveText('Alpha')
  await page.keyboard.type(' typed')
  await expect(pane(page).locator(editor)).toHaveText('A. typed')
})
