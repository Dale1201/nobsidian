import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor } from './helpers'

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
