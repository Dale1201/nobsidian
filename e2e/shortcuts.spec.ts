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
