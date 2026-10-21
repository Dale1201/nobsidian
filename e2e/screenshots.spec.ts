import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'

const SAMPLE = `---
id: 11111111-1111-4111-8111-111111111111
icon: 🚀
---

Plan the **website redesign** with *clear* goals and a <span data-bg="yellow">highlighted</span> note.

## Goals

- [x] Audit the current site
- [ ] Draft the new structure
- Ship a <span data-color="red">faster</span> homepage

> [!callout] 💡
> Remember to involve design early.

<details>
<summary>Open questions</summary>

1. Which CMS?

</details>

| Phase | Owner |
| - | - |
| Research | Dale |

\`\`\`ts
const launch = new Date('2027-01-15')
\`\`\`

> Simplicity is the ultimate sophistication.
`

test('reference screenshots in light and dark', async ({ nb }) => {
  await mkdir(join(nb.workspace, 'Website Redesign'), { recursive: true })
  await writeFile(join(nb.workspace, 'Website Redesign.md'), SAMPLE)
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Website Redesign').click()
  await expect(page.locator('.bn-editor')).toContainText('Simplicity')
  await page.screenshot({ path: 'test-results/reference-light.png' })
  await nb.app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      ?.items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Toggle Dark Mode')
      ?.click()
  )
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'test-results/reference-dark.png' })
})
