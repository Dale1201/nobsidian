import { test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeAnthropic } from './fakeAnthropic'
import { launchElectron } from './launch'

export interface AppFixture {
  app: ElectronApplication
  page: Page
  workspace: string
  userData: string
  relaunch: () => Promise<Page>
}

export async function launch(
  userData: string,
  aiUrl?: string
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchElectron({
    args: ['out/main/index.js'],
    env: {
      NOBSIDIAN_USER_DATA: userData,
      NODE_ENV: 'test',
      ...(aiUrl ? { NOBSIDIAN_AI_BASE_URL: aiUrl } : {})
    }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** A running app with a fresh, empty workspace already open, talking to a fake Anthropic. */
export const test = base.extend<{ nb: AppFixture; anthropic: FakeAnthropic }>({
  anthropic: async ({}, use) => {
    const fake = await FakeAnthropic.start()
    await use(fake)
    await fake.close()
  },
  nb: async ({ anthropic }, use) => {
    const userData = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-user-'))
    const workspace = await mkdtemp(join(tmpdir(), 'nobsidian-e2e-ws-'))
    await mkdir(userData, { recursive: true })
    await writeFile(join(userData, 'settings.json'), JSON.stringify({ lastWorkspace: workspace }))
    let { app, page } = await launch(userData, anthropic.url)
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
        ;({ app, page } = await launch(userData, anthropic.url))
        return page
      }
    }
    await use(fixture)
    await app.close()
  }
})

export { expect } from '@playwright/test'
