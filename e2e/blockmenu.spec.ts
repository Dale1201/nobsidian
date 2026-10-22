import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { editor, openFile, waitForFile } from './helpers'

async function openBlockMenu(page: Page, text: string): Promise<void> {
  await page.locator(`${editor} .bn-block-content`, { hasText: text }).first().hover()
  await page.getByRole('button', { name: 'Block menu' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

test('the handle selects the block and opens the menu with search focused', async ({ nb }) => {
  const page = await openFile(nb, 'Menu', 'First\n\nSecond\n')
  await openBlockMenu(page, 'Second')
  await expect(page.getByPlaceholder('Search actions…')).toBeFocused()
  await expect(page.getByRole('menu').locator('.menu-section').first()).toHaveText('Text')
  const selected = page.locator(`${editor} .nb-block-selected`)
  await expect(selected).toHaveCount(1)
  await expect(selected).toContainText('Second')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(selected).toHaveCount(0)
})

test('Turn into from the submenu', async ({ nb }) => {
  const page = await openFile(nb, 'Turn', 'Make me a heading\n')
  await openBlockMenu(page, 'Make me')
  await page.getByRole('menuitem', { name: 'Turn into' }).hover()
  await page.getByRole('menuitem', { name: 'Heading 1', exact: true }).click()
  await waitForFile(join(nb.workspace, 'Turn.md'), '# Make me a heading')
})

test('search finds Turn into options and colours from the keyboard', async ({ nb }) => {
  const page = await openFile(nb, 'Search', 'Quote me\n\nColor me\n')
  await openBlockMenu(page, 'Quote me')
  await page.keyboard.type('quote')
  await page.keyboard.press('Enter')
  await openBlockMenu(page, 'Color me')
  await page.keyboard.type('red back')
  await expect(page.getByRole('menu').locator('.menu-item.active')).toHaveText('Red background')
  await page.keyboard.press('Enter')
  await waitForFile(join(nb.workspace, 'Search.md'), '> Quote me')
  await waitForFile(join(nb.workspace, 'Search.md'), 'Color me<!-- bg=red -->')
})

test('Turn into keeps children and colours', async ({ nb }) => {
  const page = await openFile(
    nb,
    'Keep',
    'Parent<!-- color=red -->\n\n<div data-children>\n\nChild\n\n</div>\n'
  )
  await openBlockMenu(page, 'Parent')
  await page.keyboard.type('bulleted')
  await page.keyboard.press('Enter')
  const block = page.locator(`${editor} .bn-block-content[data-content-type="bulletListItem"]`)
  await expect(block).toHaveAttribute('data-text-color', 'red')
  await expect(page.locator(`${editor} .bn-block-group .bn-block-group`)).toContainText('Child')
})

test('Duplicate and Delete', async ({ nb }) => {
  const page = await openFile(nb, 'Dup', 'Only once\n')
  await openBlockMenu(page, 'Only once')
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.locator(`${editor} .bn-block-content`, { hasText: 'Only once' })).toHaveCount(2)
  await openBlockMenu(page, 'Only once')
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.locator(`${editor} .bn-block-content`, { hasText: 'Only once' })).toHaveCount(1)
})

test('+ adds a block below and opens the slash menu; Option-click adds above', async ({ nb }) => {
  const page = await openFile(nb, 'Plus', 'Anchor\n')
  const anchor = page.locator(`${editor} .bn-block-content`, { hasText: 'Anchor' })
  await anchor.hover()
  await page.getByRole('button', { name: 'Add a block below' }).click()
  await expect(page.locator('.slash-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.type('below')
  await anchor.hover()
  await page.getByRole('button', { name: 'Add a block below' }).click({ modifiers: ['Alt'] })
  await page.keyboard.press('Escape')
  await page.keyboard.type('above')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText([/above/, /Anchor/, /below/])
})
