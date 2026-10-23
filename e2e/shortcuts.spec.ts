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
  // Arrow keys move ProseMirror's selection at once; a click lands a moment later than a key press.
  await page.keyboard.press('ArrowDown')
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
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'One' }).click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Meta+Shift+ArrowUp')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText([/Two/, /One/])
  await page.keyboard.press('Meta+k')
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
})

test('Esc selects the block; arrows, Shift and Backspace act on the selection', async ({ nb }) => {
  const page = await openFile(nb, 'Select', 'One\n\nTwo\n\nThree\n')
  const selected = page.locator(`${editor} .nb-block-selected`)
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'One' }).click()
  await page.keyboard.press('Escape')
  await expect(selected).toHaveText(['One'])
  await page.keyboard.press('ArrowDown')
  await expect(selected).toHaveText(['Two'])
  await page.keyboard.press('Shift+ArrowDown')
  await expect(selected).toHaveText(['Two', 'Three'])
  await page.keyboard.type('xyz')
  await expect(page.locator(editor)).not.toContainText('xyz')
  await page.keyboard.press('Backspace')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText([/One/])
})

test('Cmd+Shift+Down moves selected blocks and keeps them selected', async ({ nb }) => {
  const page = await openFile(nb, 'MoveSel', 'One\n\nTwo\n\nThree\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'One' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+Shift+ArrowDown')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText([/Two/, /One/, /Three/])
  await expect(page.locator(`${editor} .nb-block-selected`)).toHaveText(['One'])
})

test('a click or Enter returns to typing; copy takes the selected blocks', async ({ nb }) => {
  const page = await openFile(nb, 'Back', 'Alpha\n\nBeta\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'Alpha' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+c')
  const copied = await nb.app.evaluate(({ clipboard }) => clipboard.readText())
  expect(copied).toContain('Alpha')
  await page.keyboard.press('Enter')
  await expect(page.locator(`${editor} .nb-block-selected`)).toHaveCount(0)
  await page.keyboard.type('!')
  await expect(page.locator(`${editor} .bn-block-content`).first()).toHaveText('Alpha!')
  await page.keyboard.press('Escape')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'Beta' }).click()
  await expect(page.locator(`${editor} .nb-block-selected`)).toHaveCount(0)
})

test('a selection holding a parent and its child deletes both, and nothing else', async ({
  nb
}) => {
  const page = await openFile(nb, 'Nested', '- parent\n  - child\n- after\n')
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'parent' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(page.locator(`${editor} .nb-block-selected`).first()).toContainText('child')
  await page.keyboard.press('Backspace')
  await expect(page.locator(`${editor} .bn-block-content`)).toHaveText(['after'])
})

test('arrow keys skip blocks hidden in a closed toggle', async ({ nb }) => {
  const page = await openFile(
    nb,
    'Hidden',
    '<details>\n<summary>fold</summary>\n\nsecret\n\n</details>\n\nvisible\n'
  )
  await expect(page.locator(`${editor} .bn-toggle-button`)).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await page.locator(`${editor} .bn-inline-content`, { hasText: 'fold' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator(`${editor} .nb-block-selected`)).toHaveText(['visible'])
  await page.keyboard.press('Backspace')
  await waitForFile(join(nb.workspace, 'Hidden.md'), /^(?![\s\S]*visible)/)
  expect(await waitForFile(join(nb.workspace, 'Hidden.md'), 'secret')).toContain('secret')
})

test('tildes in ordinary text are left alone', async ({ nb }) => {
  const { page } = nb
  await newPage(page, 'Tildes')
  const text = 'takes ~5 to ~10 minutes, copy ~/a to ~/b, a ~ b ~ c'
  await page.keyboard.type(text)
  await expect(page.locator(`${editor} .bn-inline-content`).first()).toHaveText(text)
  await expect(page.locator(`${editor} s`)).toHaveCount(0)
  // Markdown escapes the tildes so they are not read back as strikethrough.
  await waitForFile(join(nb.workspace, 'Tildes.md'), text.replaceAll('~', '\\~'))
})
