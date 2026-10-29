import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { clickMenuItem, editor } from './helpers'

test('links, inline code and dividers look like Notion’s', async ({ nb }) => {
  await writeFile(
    join(nb.workspace, 'Look.md'),
    'A [link](https://example.com) and `code`.\n\n---\n'
  )
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Look').click()
  const body = page.locator(editor)
  const text = await body
    .locator('p')
    .first()
    .evaluate((el) => getComputedStyle(el).color)
  const link = body.getByRole('link', { name: 'link' })
  await expect(link).toHaveCSS('color', text)
  await expect(link).toHaveCSS('text-decoration-line', 'underline')
  await expect(body.locator('code')).toHaveCSS('color', 'rgb(235, 87, 87)')
  await expect(body.locator('hr')).toHaveCSS('border-top-color', 'rgba(55, 53, 47, 0.16)')
})

test('the tab bar is sized and coloured like Notion’s', async ({ nb }) => {
  await writeFile(join(nb.workspace, 'One.md'), 'One.\n')
  await writeFile(join(nb.workspace, 'Two.md'), 'Two.\n')
  const page = await nb.relaunch()
  await nb.app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'light'
  })
  await page.getByTestId('sidebar-row-One').click()
  await nb.app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'New Tab')
      ?.click()
  )
  await page.getByTestId('sidebar-row-Two').click()
  await page.getByTestId('tab-One').click()
  const bar = page.locator('.tab-bar')
  const active = page.getByTestId('tab-One')
  const inactive = page.getByTestId('tab-Two')
  await expect(bar).toHaveCSS('height', '36px')
  await expect(bar).toHaveCSS('background-color', 'rgb(248, 248, 247)')
  await expect(active).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(inactive).toHaveCSS('background-color', 'rgb(248, 248, 247)')
  await expect(active.locator('.tab-title')).toHaveCSS('font-size', '13px')
  await expect(active.locator('.tab-title')).toHaveCSS('font-weight', '500')
  await expect(inactive.locator('.tab-title')).toHaveCSS('color', 'rgba(55, 53, 47, 0.65)')
  expect((await inactive.boundingBox())!.width).toBe(200)
  const inset = await page.evaluate(
    () =>
      (window as unknown as { api: { windowControls: { inset: number } } }).api.windowControls.inset
  )
  await expect(page.locator('.tab-bar-lead')).toHaveCSS('padding-left', `${inset}px`)
  expect((await page.locator('.tab-bar-lead').boundingBox())!.width).toBe(
    (await page.getByTestId('sidebar').boundingBox())!.width
  )

  await nb.app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Toggle Dark Mode')
      ?.click()
  )
  await expect(active).toHaveCSS('background-color', 'rgb(25, 25, 25)')
  await expect(inactive).toHaveCSS('background-color', 'rgb(32, 32, 32)')
})

test('scrollbars are thin rounded thumbs with no track, like Notion’s', async ({ nb }) => {
  for (let i = 0; i < 40; i++) await writeFile(join(nb.workspace, `Page ${i}.md`), 'Text.\n')
  await writeFile(join(nb.workspace, 'Long.md'), 'Line.\n\n'.repeat(200))
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Long').click()
  await expect(page.locator(editor)).toContainText('Line.')

  const scrollers = { sidebar: page.locator('.sidebar-scroll'), page: page.locator('.page-scroll') }
  const pixel = async (scroller: keyof typeof scrollers, fromRight: number): Promise<number[]> => {
    const box = (await scrollers[scroller].boundingBox())!
    const x = Math.round(box.x + box.width - fromRight)
    const y = Math.round(box.y + 20)
    return nb.app.evaluate(
      async ({ BrowserWindow }, rect) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect)
        const [b, g, r] = image.toBitmap()
        return [r, g, b]
      },
      { x, y, width: 1, height: 1 }
    )
  }
  const expectColor = (actual: number[], expected: number[]): void =>
    actual.forEach((c, i) => expect(Math.abs(c - expected[i])).toBeLessThanOrEqual(2))

  for (const scroller of Object.values(scrollers)) {
    expect(await scroller.evaluate((el: HTMLElement) => el.offsetWidth - el.clientWidth)).toBe(12)
  }

  await nb.app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'light'
  })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expectColor(await pixel('sidebar', 6), [205, 205, 203])
  expectColor(await pixel('sidebar', 1), [248, 248, 247])
  expectColor(await pixel('page', 6), [211, 211, 209])
  expectColor(await pixel('page', 1), [255, 255, 255])

  await clickMenuItem(nb.app, 'Toggle Dark Mode')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expectColor(await pixel('sidebar', 6), [81, 81, 81])
  expectColor(await pixel('sidebar', 1), [32, 32, 32])
  expectColor(await pixel('page', 6), [76, 76, 76])
  expectColor(await pixel('page', 1), [25, 25, 25])
})
