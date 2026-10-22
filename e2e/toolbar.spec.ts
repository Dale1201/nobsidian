import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, openFile, waitForFile } from './helpers'

test('the selection toolbar has Notion buttons in Notion order', async ({ nb }) => {
  const page = await openFile(nb, 'Bar', 'Select these words\n')
  await page.locator(`${editor} .bn-inline-content`).first().dblclick()
  const toolbar = page.locator('.bn-formatting-toolbar')
  await expect(toolbar).toBeVisible()
  const names = await toolbar
    .locator('button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim()))
  expect(names).toEqual([
    'Turn into',
    'Create link',
    'Bold',
    'Italic',
    'Underline',
    'Strike',
    'Code',
    'Colors'
  ])
  await expect(toolbar.getByRole('button', { name: 'Turn into' })).toHaveText(/Text/)
})

test('Turn into from the toolbar', async ({ nb }) => {
  const page = await openFile(nb, 'TurnBar', 'Promote me\n')
  await page.locator(`${editor} .bn-inline-content`).first().dblclick()
  await page.locator('.bn-formatting-toolbar').getByRole('button', { name: 'Turn into' }).click()
  await page.getByRole('menuitem', { name: 'Heading 2', exact: true }).click()
  await waitForFile(join(nb.workspace, 'TurnBar.md'), '## Promote me')
})

test('toolbar buttons show their shortcut', async ({ nb }) => {
  const page = await openFile(nb, 'Tips', 'Hover the bold button\n')
  await page.locator(`${editor} .bn-inline-content`).first().dblclick()
  await page.locator('.bn-formatting-toolbar').getByRole('button', { name: 'Bold' }).hover()
  await expect(page.getByRole('tooltip')).toContainText('⌘B')
})

test('typing while the Turn into dropdown is open does not change the text', async ({ nb }) => {
  const page = await openFile(nb, 'Keep', 'Leave these words\n')
  await page.locator(`${editor} .bn-inline-content`).first().dblclick()
  await page.locator('.bn-formatting-toolbar').getByRole('button', { name: 'Turn into' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.type('xyz')
  await page.keyboard.press('Backspace')
  await expect(page.locator(`${editor} .bn-inline-content`).first()).toHaveText('Leave these words')
  await expect(page.getByRole('menu')).toBeVisible()
})
