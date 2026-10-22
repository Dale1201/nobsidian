import { createServer, type Server } from 'node:http'
import { createWriteStream } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ElectronApplication } from '@playwright/test'
import yazl from 'yazl'
import { expect, test } from './fixtures'
import { editor, waitForFile } from './helpers'

const FIXTURES = resolve('tests/fixtures')
const EXPORT_ZIP = join(FIXTURES, 'notion-export.zip')

// "Web" images the export links to are served locally.
let server: Server
test.beforeAll(async () => {
  const png = await readFile(join(FIXTURES, 'web-image.png'))
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(png)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  process.env.NOBSIDIAN_E2E_WEB = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => server.close())

async function importViaMenu(app: ElectronApplication, zips: string[]): Promise<void> {
  // The renderer ignores the command until the workspace has loaded.
  await expect((await app.firstWindow()).getByRole('button', { name: 'Search' })).toBeVisible()
  await app.evaluate(({ dialog, Menu }, filePaths) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths
    })) as typeof dialog.showOpenDialog
    Menu.getApplicationMenu()!.getMenuItemById('import-notion')!.click()
  }, zips)
}

test('imports a Notion export with its pages, images, colors and links', async ({ nb }) => {
  const { app, page } = nb
  await importViaMenu(app, [EXPORT_ZIP])
  const panel = page.getByRole('status')
  await expect(panel).toContainText('Imported 10 pages. 2 things need a look.')
  await panel.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByTestId('page-title')).toHaveText('Imported from Notion')

  await page.getByTestId('sidebar-row-Nobsidian import fixture').click()
  await expect(page.getByTestId('page-title')).toHaveText('Nobsidian import fixture')
  const body = page.locator(editor)
  await expect(body.getByRole('heading', { name: 'Heading 1', exact: true })).toBeVisible()
  await expect(body.locator('[data-style-type="textColor"][data-value="red"]').first()).toHaveText(
    'red'
  )
  await expect(body.getByText('An orange callout with a custom icon')).toBeVisible()
  await expect(body.getByText('🚧')).toBeVisible()
  const image = body
    .locator('img[alt="An uploaded image with a caption"], .bn-visual-media')
    .first()
  await expect(image).toBeVisible()
  await expect(page.getByTestId('page-cover')).toBeVisible()

  // A page mention leads to the imported page.
  await body.getByRole('link', { name: 'Grandchild page' }).first().click()
  await expect(page.getByTestId('page-title')).toHaveText('Grandchild page')

  const root = join(nb.workspace, 'Imported from Notion')
  expect((await readdir(join(nb.workspace, 'attachments'))).sort()).toEqual([
    'fixture-image.png',
    'fixture-report.pdf',
    'gradients_2.png',
    'gradients_8.png'
  ])
  await waitForFile(join(root, 'Nobsidian import fixture.md'), '> [!callout:orange_bg] 🚧')
  const report = await readFile(join(root, 'Import report.md'), 'utf8')
  expect(report).toContain('## Table formatting not kept (2)')
  expect(await readdir(join(nb.workspace, '.nobsidian'))).not.toContainEqual(
    expect.stringMatching(/^import-/)
  )
})

test('a second import lands next to the first one', async ({ nb }) => {
  const { app, page } = nb
  await importViaMenu(app, [EXPORT_ZIP])
  await expect(page.getByRole('status')).toContainText('Imported 10 pages')
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await importViaMenu(app, [EXPORT_ZIP])
  await expect(page.getByRole('status')).toContainText('Imported 10 pages')
  await expect(page.getByTestId('sidebar-row-Imported from Notion')).toBeVisible()
  await expect(page.getByTestId('sidebar-row-Imported from Notion (2)')).toBeVisible()
  await waitForFile(join(nb.workspace, 'Imported from Notion (2).md'), 'id:')
  expect(await readdir(join(nb.workspace, 'attachments'))).toContain('fixture-image (2).png')
})

test('cancelling an import leaves nothing behind', async ({ nb }) => {
  const big = join(nb.userData, 'big-export.zip')
  await writeBigExport(big, 1500)
  const { app, page } = nb
  await importViaMenu(app, [big])
  const panel = page.getByRole('status')
  await expect(panel).toContainText('Converting pages')
  await panel.getByRole('button', { name: 'Cancel' }).click()
  await expect(panel).toContainText('Cancelled, nothing was imported.')
  await expect(page.getByTestId('sidebar-row-Imported from Notion')).toHaveCount(0)
  const appDir = await readdir(join(nb.workspace, '.nobsidian')).catch(() => [])
  expect(appDir.filter((name) => name.startsWith('import-'))).toEqual([])
})

test('a zip that is not a Notion HTML export is refused', async ({ nb }) => {
  const zip = join(nb.userData, 'notes.zip')
  const out = new yazl.ZipFile()
  out.addBuffer(Buffer.from('# Notes\n'), 'Notes 0123456789abcdef0123456789abcdef.md')
  out.end()
  await pipeline(out.outputStream, createWriteStream(zip))
  await importViaMenu(nb.app, [zip])
  await expect(nb.page.getByRole('alert')).toContainText(
    'This is a Markdown export. Export again as HTML.'
  )
  await expect(nb.page.getByTestId('sidebar-row-Imported from Notion')).toHaveCount(0)
})

async function writeBigExport(path: string, pages: number): Promise<void> {
  const zip = new yazl.ZipFile()
  const paragraph = `<p>${'Some words in a long paragraph. '.repeat(40)}</p>`.repeat(30)
  for (let i = 0; i < pages; i++) {
    const id = i.toString(16).padStart(32, '0')
    const html =
      `<html><body><article class="page"><header><h1 class="page-title">Page ${i}</h1></header>` +
      `<div class="page-body">${paragraph}</div></article></body></html>`
    zip.addBuffer(Buffer.from(html), `Private & Shared/Page ${i} ${id}.html`)
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path))
}
