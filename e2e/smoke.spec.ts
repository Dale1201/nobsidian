import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('launches a sandboxed window titled Nobsidian', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'nobsidian-smoke-'))
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('Nobsidian')
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(userData)
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe(
    'undefined'
  )
  await app.close()
})
