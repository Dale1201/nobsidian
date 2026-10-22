import { test, expect } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchElectron } from '../e2e/launch'

const APP = resolve('dist/mac-arm64/Nobsidian.app/Contents/MacOS/Nobsidian')

test('the packaged app launches to the welcome screen', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-packaged-'))
  const app = await launchElectron({
    executablePath: APP,
    env: { NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page.getByText('Welcome to Nobsidian')).toBeVisible()
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  await app.close()
})

test('the packaged app imports a Notion export in its worker', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-packaged-'))
  const workspace = await mkdtemp(join(tmpdir(), 'nobsidian-packaged-ws-'))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ lastWorkspace: workspace }))
  const app = await launchElectron({
    executablePath: APP,
    env: { NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible()
  await app.evaluate(
    ({ dialog, Menu }, filePaths) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths
      })) as typeof dialog.showOpenDialog
      Menu.getApplicationMenu()!.getMenuItemById('import-notion')!.click()
    },
    [resolve('tests/fixtures/notion-export.zip')]
  )
  // External images are not served here, so some downloads may be reported.
  await expect(page.getByRole('status')).toContainText('Imported 10 pages')
  await app.close()
})
