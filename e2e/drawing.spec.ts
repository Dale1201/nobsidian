import { chmod, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { newPage, openFile, rowAction, waitForFile } from './helpers'

const SQUARE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#fff"/><rect x="10" y="10" width="100" height="60" fill="none" stroke="#1e1e1e"/></svg>'

async function writeDrawing(workspace: string, name: string): Promise<void> {
  await mkdir(join(workspace, 'attachments'), { recursive: true })
  await writeFile(join(workspace, 'attachments', name), SQUARE)
}

const toggleDarkMode = (app: ElectronApplication): Promise<unknown> =>
  app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Toggle Dark Mode')
      ?.click()
  )

test('a drawing shows as its picture, at the size it was drawn', async ({ nb }) => {
  await writeDrawing(nb.workspace, 'Square.excalidraw.svg')
  const page = await openFile(nb, 'Pictures', 'Above\n\n![](attachments/Square.excalidraw.svg)\n')
  const image = page.locator('.nb-drawing img')
  await expect(image).toHaveJSProperty('naturalWidth', 120)
  expect((await image.boundingBox())!.width).toBe(120)
})

test('the dark theme inverts a drawing so its white background matches the page', async ({
  nb
}) => {
  await writeDrawing(nb.workspace, 'Square.excalidraw.svg')
  const page = await openFile(nb, 'Night', '![](attachments/Square.excalidraw.svg)\n')
  await expect(page.locator('.nb-drawing img')).toHaveCSS('filter', 'none')
  await toggleDarkMode(nb.app)
  await expect(page.locator('.nb-drawing img')).toHaveCSS(
    'filter',
    'invert(0.9) hue-rotate(180deg)'
  )
})

test('a drawing whose file is missing says so', async ({ nb }) => {
  const page = await openFile(nb, 'Lost', '![](attachments/Gone.excalidraw.svg)\n')
  await expect(page.locator('.nb-drawing-missing')).toHaveText(
    'Drawing not found: Gone.excalidraw.svg'
  )
})

const overlay = (page: Page): Locator => page.getByRole('dialog', { name: 'Drawing' })

async function insertDrawing(page: Page): Promise<void> {
  await page.keyboard.type('/drawing')
  await page.keyboard.press('Enter')
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
}

async function drawRectangle(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('r')
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 200, y + 120, { steps: 5 })
  await page.mouse.up()
}

async function done(page: Page): Promise<void> {
  await overlay(page).getByRole('button', { name: 'Done' }).click()
  await expect(overlay(page)).toBeHidden()
}

const attachments = (workspace: string): Promise<string[]> =>
  readdir(join(workspace, 'attachments')).catch(() => [])

test('a drawing made from the slash menu is saved as an image link to an editable SVG', async ({
  nb
}) => {
  const { page } = nb
  await newPage(page, 'Sketch')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await done(page)
  const image = page.locator('.nb-drawing img')
  await expect(image).toHaveJSProperty('complete', true)
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(200)
  await waitForFile(join(nb.workspace, 'Sketch.md'), '![](attachments/Drawing.excalidraw.svg)\n')
  const svg = await readFile(join(nb.workspace, 'attachments', 'Drawing.excalidraw.svg'), 'utf8')
  expect(svg).toMatch(/^<svg/)
  expect(svg).toContain('payload-type:application/vnd.excalidraw+json')
})

test('reopening shows the drawing; an edit saves a new file and leaving it unchanged saves none', async ({
  nb
}) => {
  const { page } = nb
  await newPage(page, 'Edits')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await done(page)
  await waitForFile(join(nb.workspace, 'Edits.md'), 'Drawing.excalidraw.svg')

  await page.locator('.nb-drawing').click()
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
  await done(page)
  expect(await attachments(nb.workspace)).toEqual(['Drawing.excalidraw.svg'])

  await page.locator('.nb-drawing').click()
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
  await drawRectangle(page, 300, 600)
  await done(page)
  await waitForFile(
    join(nb.workspace, 'Edits.md'),
    '![](attachments/Drawing%20\\(2\\).excalidraw.svg)'
  )
  expect((await attachments(nb.workspace)).sort()).toEqual([
    'Drawing (2).excalidraw.svg',
    'Drawing.excalidraw.svg'
  ])
})

test('closing a new drawing without drawing removes its block', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Empty')
  await page.keyboard.type('Before')
  await page.keyboard.press('Enter')
  await insertDrawing(page)
  await done(page)
  await expect(page.locator('.bn-block-content[data-content-type="drawing"]')).toHaveCount(0)
  await page.keyboard.type('After')
  await waitForFile(join(nb.workspace, 'Empty.md'), /Before\n\nAfter\n$/)
  expect(await attachments(nb.workspace)).toEqual([])
})

test('Enter opens a selected drawing and Cmd+Enter saves it', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Keys')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await page.keyboard.press('Meta+Enter')
  await expect(overlay(page)).toBeHidden()
  await waitForFile(join(nb.workspace, 'Keys.md'), 'Drawing.excalidraw.svg')
  await expect(page.locator('.nb-block-selected .nb-drawing')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
})

test('quitting with the editor open keeps the drawing', async ({ nb }) => {
  await newPage(nb.page, 'Quit')
  await insertDrawing(nb.page)
  await drawRectangle(nb.page, 500, 400)
  const page = await nb.relaunch()
  await expect(page.locator('.nb-drawing img')).toBeVisible()
  expect(await readFile(join(nb.workspace, 'Quit.md'), 'utf8')).toContain(
    '![](attachments/Drawing.excalidraw.svg)'
  )
})

test('the editor follows the app theme, also when it changes while open', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Themes')
  await insertDrawing(page)
  await expect(overlay(page)).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await toggleDarkMode(nb.app)
  await expect(overlay(page).locator('.excalidraw.theme--dark')).toBeVisible()
  await expect(overlay(page)).toHaveCSS('background-color', 'rgb(18, 18, 18)')
})

test('drawing stays offline and its code loads only when the editor opens', async ({ nb }) => {
  const { page } = nb
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await newPage(page, 'Offline')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await page.keyboard.press('t')
  await page.mouse.click(520, 600)
  await page.keyboard.type('Hi 你好')
  await page.keyboard.press('Escape')
  await done(page)
  const svg = await waitForFile(
    join(nb.workspace, 'attachments', 'Drawing.excalidraw.svg'),
    'font-family: Xiaolai'
  )
  expect(svg).toContain('font-family: Excalifont')
  expect(requests.filter((u) => !/^(file|data|blob|nbfile):/.test(u))).toEqual([])

  requests.length = 0
  const reopened = await nb.relaunch()
  reopened.on('request', (r) => requests.push(r.url()))
  await reopened.getByTestId('sidebar-row-Offline').click()
  await expect(reopened.locator('.nb-drawing img')).toBeVisible()
  expect(requests.filter((u) => /DrawingEditor|excalidraw\//.test(u))).toEqual([])
})

test('a copied drawing is edited on its own', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Copies')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await done(page)
  await page.keyboard.press('Meta+d')
  await expect(page.locator('.nb-drawing')).toHaveCount(2)
  await page.locator('.nb-drawing').nth(1).click()
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
  await drawRectangle(page, 300, 600)
  await done(page)
  await waitForFile(
    join(nb.workspace, 'Copies.md'),
    '![](attachments/Drawing.excalidraw.svg)\n\n![](attachments/Drawing%20\\(2\\).excalidraw.svg)\n'
  )
})

test('a drawing in a read-only page does not open', async ({ nb }) => {
  await writeDrawing(nb.workspace, 'Old.excalidraw.svg')
  const page = await openFile(nb, 'Old', 'Text\n\n![](attachments/Old.excalidraw.svg)\n')
  await expect(page.locator('.nb-drawing')).toHaveCSS('cursor', 'pointer')
  await rowAction(page, 'Old', 'Delete')
  await page.getByRole('button', { name: 'Trash' }).click()
  await page.getByTestId('trash-item-Old').click()
  await expect(page.getByRole('status')).toContainText('This page is in Trash.')
  await expect(page.locator('.nb-drawing')).toHaveCSS('cursor', 'auto')
  await page.locator('.nb-drawing img').click()
  await expect(overlay(page)).toHaveCount(0)
})

test('a plain SVG named like a drawing opens as not editable and is never overwritten', async ({
  nb
}) => {
  await writeDrawing(nb.workspace, 'Logo.excalidraw.svg')
  const page = await openFile(nb, 'Plain', '![](attachments/Logo.excalidraw.svg)\n')
  await page.locator('.nb-drawing').click()
  await expect(overlay(page)).toContainText("This drawing can't be edited")
  await expect(overlay(page).locator('.excalidraw')).toHaveCount(0)
  await done(page)
  expect(await attachments(nb.workspace)).toEqual(['Logo.excalidraw.svg'])
  expect(await readFile(join(nb.workspace, 'attachments', 'Logo.excalidraw.svg'), 'utf8')).toBe(
    SQUARE
  )
})

test('a drawing still lands when its page changes on disk while it is open', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Outside')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await done(page)
  const file = join(nb.workspace, 'Outside.md')
  const text = await waitForFile(file, 'Drawing.excalidraw.svg')
  await page.locator('.nb-drawing').click()
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
  await writeFile(file, `${text}\nTheirs\n`)
  await expect(page.locator('.bn-editor')).toContainText('Theirs')
  await drawRectangle(page, 300, 600)
  await done(page)
  await waitForFile(file, /!\[\]\(attachments\/Drawing%20\\\(2\\\)\.excalidraw\.svg\)\n\nTheirs\n$/)
})

test('a new drawing still lands when its page changes on disk while it is open', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Fresh')
  await page.keyboard.type('Before')
  await page.keyboard.press('Enter')
  await insertDrawing(page)
  const file = join(nb.workspace, 'Fresh.md')
  const text = await waitForFile(file, /Before\n$/)
  await writeFile(file, `${text}\nTheirs\n`)
  await expect(page.locator('.bn-editor')).toContainText('Theirs')
  await drawRectangle(page, 500, 400)
  await done(page)
  await waitForFile(file, /Before\n\n!\[\]\(attachments\/Drawing\.excalidraw\.svg\)\n\nTheirs\n$/)
})

test('a drawing that cannot be saved says so over the editor and stays open', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Locked')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  const dir = join(nb.workspace, 'attachments')
  await mkdir(dir)
  await chmod(dir, 0o500)
  try {
    await overlay(page).getByRole('button', { name: 'Done' }).click()
    const toast = page.getByRole('alert')
    await expect(toast).toContainText("Couldn't save the drawing")
    const box = (await toast.boundingBox())!
    const topmost = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="alert"]') !== null,
      [box.x + box.width / 2, box.y + box.height / 2]
    )
    expect(topmost).toBe(true)
    await expect(overlay(page)).toBeVisible()
  } finally {
    await chmod(dir, 0o755)
  }
  await done(page)
  await waitForFile(join(nb.workspace, 'Locked.md'), 'Drawing.excalidraw.svg')
})

test('a drawing that cannot be read says so and can be closed', async ({ nb }) => {
  await writeDrawing(nb.workspace, 'Secret.excalidraw.svg')
  const file = join(nb.workspace, 'attachments', 'Secret.excalidraw.svg')
  const page = await openFile(nb, 'Unreadable', '![](attachments/Secret.excalidraw.svg)\n')
  await expect(page.locator('.nb-drawing img')).toHaveJSProperty('complete', true)
  await chmod(file, 0o000)
  try {
    await page.locator('.nb-drawing').click()
    await expect(overlay(page)).toContainText("Couldn't open the drawing")
    await done(page)
  } finally {
    await chmod(file, 0o644)
  }
})

test('replacing a shape with a new one is saved', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Swap')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  await done(page)
  await waitForFile(join(nb.workspace, 'Swap.md'), 'Drawing.excalidraw.svg')
  await page.locator('.nb-drawing').click()
  await expect(overlay(page).locator('.excalidraw')).toBeVisible()
  await page.keyboard.press('Meta+a')
  await page.keyboard.press('Delete')
  await drawRectangle(page, 300, 600)
  await done(page)
  await waitForFile(join(nb.workspace, 'Swap.md'), 'Drawing%20\\(2\\).excalidraw.svg')
})

test('the page under the drawing editor cannot be reached', async ({ nb }) => {
  await writeDrawing(nb.workspace, 'Logo.excalidraw.svg')
  const page = await openFile(nb, 'Under', 'Text\n\n![](attachments/Logo.excalidraw.svg)\n')
  const styled = await page.evaluate(() =>
    [...document.styleSheets].some((sheet) =>
      [...sheet.cssRules].some((rule) => rule.cssText.startsWith('.drawing-overlay'))
    )
  )
  expect(styled).toBe(true)
  await page.locator('.bn-editor').getByText('Text').click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.nb-block-selected .nb-drawing')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(overlay(page)).toContainText("This drawing can't be edited")
  await expect(overlay(page).getByRole('button', { name: 'Done' })).toBeFocused()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await expect(overlay(page)).toBeHidden()
  await expect(page.locator('.nb-drawing')).toBeVisible()
})

test('the drawing editor failing to load shows an error instead of a blank window', async ({
  nb
}) => {
  const assets = join('out', 'renderer', 'assets')
  const chunk = (await readdir(assets)).find((f) => /^DrawingEditor-.*\.js$/.test(f))!
  await rename(join(assets, chunk), join(assets, `${chunk}.off`))
  try {
    const { page } = nb
    await newPage(page, 'Broken')
    await page.keyboard.type('/drawing')
    await page.keyboard.press('Enter')
    await expect(overlay(page)).toContainText("Couldn't open the drawing editor")
    await done(page)
    await expect(page.getByTestId('sidebar-row-Broken')).toBeVisible()
  } finally {
    await rename(join(assets, `${chunk}.off`), join(assets, chunk))
  }
})

test('the block menu names a drawing', async ({ nb }) => {
  await writeDrawing(nb.workspace, 'Square.excalidraw.svg')
  const page = await openFile(nb, 'Named', '![](attachments/Square.excalidraw.svg)\n')
  await page.locator('.nb-drawing').hover()
  await page.getByRole('button', { name: 'Block menu' }).click()
  await expect(page.getByRole('menu').locator('.menu-section').first()).toHaveText('Drawing')
})

test('strokes drawn while a save is running are saved too', async ({ nb }) => {
  const { page, app } = nb
  await newPage(page, 'Busy')
  await insertDrawing(page)
  await drawRectangle(page, 500, 400)
  // Holds every save in the main process until released, counting them.
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as { saves?: number; release?: () => void }
    let opened: Promise<void> = new Promise((resolve) => (g.release = resolve))
    g.saves = 0
    ipcMain.removeHandler('attachment:save')
    ipcMain.handle('attachment:save', async () => {
      g.saves! += 1
      await opened
      opened = Promise.resolve()
      return `/attachments/Saved%20${g.saves}.excalidraw.svg`
    })
  })
  await overlay(page).getByRole('button', { name: 'Done' }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as { saves?: number }).saves)).toBe(1)
  // Clicking Done left focus on the button; Excalidraw takes its tool keys only when focused.
  await page.mouse.click(900, 300)
  await drawRectangle(page, 300, 600)
  await app.evaluate(() => (globalThis as { release?: () => void }).release!())
  await expect(overlay(page)).toBeHidden()
  expect(await app.evaluate(() => (globalThis as { saves?: number }).saves)).toBe(2)
  await waitForFile(join(nb.workspace, 'Busy.md'), 'Saved%202.excalidraw.svg')
})
