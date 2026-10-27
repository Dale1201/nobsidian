import { expect, test } from './fixtures'
import { launchElectron } from './launch'

test('launches a sandboxed window titled Nobsidian', async ({ tmp }) => {
  const userData = await tmp('user')
  const app = await launchElectron({
    args: ['out/main/index.js'],
    env: { NOBSIDIAN_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await expect(page).toHaveTitle('Nobsidian')
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(userData)
  if (process.env.NOBSIDIAN_E2E_SHOW !== '1') {
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
    ).toBe(false)
  }
  expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe(
    'undefined'
  )
  await app.close()
})
