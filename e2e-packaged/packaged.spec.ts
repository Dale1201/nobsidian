import { test, expect } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
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
