import { join } from 'node:path'
import { expect, test } from './fixtures'
import { editor, newPage, waitForFile } from './helpers'

test('page history previews an older version and restores it', async ({ nb }) => {
  const { page, workspace } = nb
  await newPage(page, 'Essay')
  await page.keyboard.type('First draft')
  await waitForFile(join(workspace, 'Essay.md'), 'First draft')

  const openHistory = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Page menu' }).click()
    await page.getByRole('button', { name: 'Page history' }).click()
  }
  await openHistory()
  const dialog = page.getByRole('dialog', { name: 'Page history' })
  await expect(dialog.locator('.history-item')).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Close' }).click()

  await page.locator(editor).click()
  await page.keyboard.press('End')
  await page.keyboard.type(', then rewritten')
  await waitForFile(join(workspace, 'Essay.md'), 'then rewritten')
  await openHistory()
  await expect(dialog.locator('.history-item')).toHaveCount(2)
  await expect(dialog.locator('.history-item').first()).toContainText('Current')
  await expect(dialog.getByRole('button', { name: 'Restore version' })).toBeDisabled()

  await dialog.locator('.history-item').nth(1).click()
  await expect(dialog.locator('.history-preview')).toContainText('First draft')
  await expect(dialog.locator('.history-preview')).not.toContainText('rewritten')
  await dialog.getByRole('button', { name: 'Restore version' }).click()
  const confirm = page.getByRole('dialog', { name: /^Restore the version from/ })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(confirm.locator(':focus')).toHaveCount(1)
  await confirm.getByRole('button', { name: 'Restore' }).click()

  await expect(page.locator(editor)).toHaveText('First draft')
  await waitForFile(join(workspace, 'Essay.md'), /\n\nFirst draft\n$/)
})
