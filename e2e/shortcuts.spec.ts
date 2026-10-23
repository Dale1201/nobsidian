import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { editor, newPage, openFile, waitForFile } from './helpers'

const lastType = (page: Page): Promise<string | null> =>
  page.locator(`${editor} .bn-block-content`).last().getAttribute('data-content-type')

const typed: [string, string, string][] = [
  ['- item', 'bulletListItem', '- item'],
  ['* item', 'bulletListItem', '- item'],
  ['+ item', 'bulletListItem', '- item'],
  ['1. item', 'numberedListItem', '1. item'],
  ['[] item', 'checkListItem', '- [ ] item'],
  ['> item', 'toggleListItem', '<summary>item</summary>'],
  ['" item', 'quote', '> item'],
  ['# item', 'heading', '# item'],
  ['## item', 'heading', '## item'],
  ['### item', 'heading', '### item']
]

for (const [keys, type, saved] of typed) {
  test(`typing "${keys}" makes a ${type}`, async ({ nb }) => {
    const { page } = nb
    await newPage(page, 'Typing')
    await page.keyboard.type(keys)
    await expect.poll(() => lastType(page)).toBe(type)
    await waitForFile(join(nb.workspace, 'Typing.md'), saved)
  })
}

test('#### stays text, as Notion has three heading levels', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Four')
  await page.keyboard.type('#### item')
  await waitForFile(join(nb.workspace, 'Four.md'), '#### item')
  expect(await lastType(page)).toBe('paragraph')
})

test('--- makes a divider and ``` makes a code block at once', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Blocks')
  await page.keyboard.type('---')
  await expect(page.locator(`${editor} [data-content-type="divider"]`)).toHaveCount(1)
  await page.keyboard.type('```')
  await expect.poll(() => lastType(page)).toBe('codeBlock')
})

test('typing carries on below a --- divider, as in Notion', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'After')
  await page.keyboard.type('---abc')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText(['', 'abc'])
  await expect(page.locator(`${editor} .bn-block-content`).first()).toHaveAttribute(
    'data-content-type',
    'divider'
  )
})

test('inline Markdown, including single-tilde strikethrough', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Inline')
  await page.keyboard.type('**bold** *it* `code` ~gone~ ')
  await waitForFile(join(nb.workspace, 'Inline.md'), '**bold** *it* `code` ~~gone~~')
})

test('files with > quotes still open as quotes', async ({ nb }) => {
  const page = await openFile(nb, 'Quoted', '> Quoted text\n')
  await expect(page.locator(`${editor} [data-content-type="quote"]`)).toHaveCount(1)
})

test('Cmd+D duplicates the block', async ({ nb }) => {
  const page = await openFile(nb, 'Dup', 'Copy me\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'Copy me' }).click()
  await page.keyboard.press('Meta+d')
  await expect(page.locator(`${editor} .bn-block-content`, { hasText: 'Copy me' })).toHaveCount(2)
})

const turnKeys: [string, string][] = [
  ['4', 'checkListItem'],
  ['5', 'bulletListItem'],
  ['6', 'numberedListItem'],
  ['7', 'toggleListItem'],
  ['8', 'codeBlock'],
  ['1', 'heading'],
  ['0', 'paragraph']
]

test('Cmd+Option+number turns the block into Notion types', async ({ nb }) => {
  const page = await openFile(nb, 'Turns', 'Shape shifter\n')
  for (const [key, type] of turnKeys) {
    await page.locator(`${editor} .bn-block-content`).first().click()
    await page.keyboard.press(`Meta+Alt+${key}`)
    await expect(page.locator(`${editor} .bn-block-content`).first()).toHaveAttribute(
      'data-content-type',
      type
    )
  }
})

test('Cmd+Enter ticks a to-do and opens a toggle', async ({ nb }) => {
  const page = await openFile(
    nb,
    'Enter',
    '- [ ] task\n\n<details>\n<summary>fold</summary>\n\ninside\n\n</details>\n'
  )
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'task' }).click()
  await page.keyboard.press('Meta+Enter')
  await waitForFile(join(nb.workspace, 'Enter.md'), '- [x] task')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'fold' }).click()
  await page.keyboard.press('Meta+Enter')
  await expect(page.locator(`${editor} .bn-toggle-button`)).toHaveAttribute('aria-expanded', 'true')
})

test('Cmd+/ opens the block menu with search focused', async ({ nb }) => {
  const page = await openFile(nb, 'Slash', 'Change me\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'Change me' }).click()
  await page.keyboard.press('Meta+/')
  await expect(page.getByPlaceholder('Search actions…')).toBeFocused()
  await page.keyboard.type('heading 2')
  await page.keyboard.press('Enter')
  await waitForFile(join(nb.workspace, 'Slash.md'), '## Change me')
})

test('Cmd+Shift+Up moves the block, and Cmd+K opens search', async ({ nb }) => {
  const page = await openFile(nb, 'Move', 'One\n\nTwo\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'Two' }).click()
  await page.keyboard.press('Meta+Shift+ArrowUp')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText([/Two/, /One/])
  await page.keyboard.press('Meta+k')
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
})
