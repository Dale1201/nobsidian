import { _electron as electron, type ElectronApplication } from '@playwright/test'

type LaunchOptions = NonNullable<Parameters<typeof electron.launch>[0]>

/** Every test launch goes through here, so the app runs hidden (NOBSIDIAN_E2E_SHOW=1 shows it). */
export function launchElectron(options: LaunchOptions): Promise<ElectronApplication> {
  return electron.launch({
    ...options,
    // Pixel checks read colors in the display's profile; sRGB keeps them the same on every Mac.
    args: ['--force-color-profile=srgb', ...(options.args ?? [])],
    env: { ...process.env, ...options.env, NOBSIDIAN_E2E: '1' }
  })
}
