import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface AppFixture {
  app: ElectronApplication
  page: Page
  workspace: string
  userData: string
  relaunch: () => Promise<Page>
}

export async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NOBSIDIAN_USER_DATA: userData, NODE_ENV: 'test' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** A running app with a fresh, empty workspace already open. */
export const test = base.extend<{ nb: AppFixture }>({
  nb: async ({}, use) => {
    const userData = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-user-'))
    const workspace = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-ws-'))
    await mkdir(userData, { recursive: true })
    await writeFile(join(userData, 'settings.json'), JSON.stringify({ lastWorkspace: workspace }))
    let { app, page } = await launch(userData)
    const fixture: AppFixture = {
      get app() {
        return app
      },
      get page() {
        return page
      },
      workspace,
      userData,
      relaunch: async () => {
        await app.close()
        ;({ app, page } = await launch(userData))
        return page
      }
    }
    await use(fixture)
    await app.close()
  }
})

export { expect } from '@playwright/test'
