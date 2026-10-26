import { join } from 'node:path'
import type { ElectronApplication, Locator } from '@playwright/test'
import { expect, test } from './fixtures'
import { editor, newPage, waitForFile } from './helpers'

/** Records the right-click menu instead of showing it, as a native menu can't be driven. */
async function captureMenus(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const g = globalThis as { lastMenu?: Electron.Menu }
    Menu.prototype.popup = function (this: Electron.Menu) {
      g.lastMenu = this
    }
  })
}

async function wordCenter(block: Locator, word: string): Promise<{ x: number; y: number }> {
  return block.evaluate((el, word) => {
    const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!
    const start = node.textContent!.indexOf(word)
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + word.length)
    const rect = range.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }, word)
}

const menuLabels = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() =>
    ((globalThis as { lastMenu?: Electron.Menu }).lastMenu?.items ?? []).map(
      (item) => item.label || item.type
    )
  )

test('right-clicking a misspelled word offers fixes that replace it', async ({ nb }) => {
  const { app, page } = nb
  await captureMenus(app)
  await newPage(page, 'Spelling')
  await page.keyboard.type('Fix this mispeled word ')
  const block = page.locator(`${editor} .bn-inline-content`).first()
  await expect(block).toHaveText('Fix this mispeled word')

  const word = await wordCenter(block, 'mispeled')
  await expect
    .poll(async () => {
      await page.mouse.click(word.x, word.y, { button: 'right' })
      return (await menuLabels(app))[0]
    })
    .toBe('misspelled')
  expect(await menuLabels(app)).toEqual(
    expect.arrayContaining(['Learn Spelling', 'Cut', 'Copy', 'Paste'])
  )

  await app.evaluate(({ BrowserWindow }) => {
    const menu = (globalThis as { lastMenu?: Electron.Menu }).lastMenu!
    const win = BrowserWindow.getAllWindows()[0]
    menu.items[0].click(undefined, win, win.webContents)
  })
  await expect(block).toHaveText('Fix this misspelled word')
  await waitForFile(join(nb.workspace, 'Spelling.md'), 'Fix this misspelled word')
  await page.keyboard.press('Meta+z')
  await expect(block).toHaveText('Fix this mispeled word')
})

test('right-clicking a correct word shows only the edit actions', async ({ nb }) => {
  const { app, page } = nb
  await captureMenus(app)
  await newPage(page, 'Correct')
  await page.keyboard.type('Every word here is right')
  await page.getByText('Every word here is right').click({ button: 'right' })
  await expect.poll(() => menuLabels(app)).toEqual(['Cut', 'Copy', 'Paste'])
})
