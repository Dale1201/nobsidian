import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { GOOD_KEY } from './fakeAnthropic'
import { expect, test, type AppFixture } from './fixtures'
import { clickMenuItem, editor, waitForFile } from './helpers'

const PAGE = 'Intro.\n\nWe spent the hour arguing about launch.\n\nOutro.\n'
const MARKS = '.nb-ai-added, .nb-ai-removed, .nb-ai-added-block, .nb-ai-removed-block'

async function setUp(nb: AppFixture, body = PAGE): Promise<Page> {
  await nb.page.evaluate((key) => window.api.invoke('ai:setKey', { key }), GOOD_KEY)
  await writeFile(join(nb.workspace, 'Notes.md'), body)
  await writeFile(join(nb.workspace, 'Other.md'), 'Elsewhere.\n')
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Notes').click()
  await expect(page.locator(editor)).toContainText('Outro.')
  await waitForFile(join(nb.workspace, 'Notes.md'), /^---\nid: /)
  return page
}

const blockText = (page: Page, index: number): Promise<string | null> =>
  page
    .locator('.bn-block-content')
    .nth(index)
    .evaluate((el) => el.textContent)

const columnsOf = (left: string, right: string): string =>
  `<div data-columns>\n\n<div data-column>\n\n${left}\n\n</div>\n\n<div data-column>\n\n${right}\n\n</div>\n\n</div>\n\n`

async function askAbout(page: Page, text: string): Promise<void> {
  await page.locator(editor).getByText(text).click({ clickCount: 3 })
  await page.keyboard.press('Meta+j')
}

test('each failure says what went wrong, and keeps what had arrived', async ({ nb, anthropic }) => {
  const page = await setUp(nb)
  const writer = page.getByRole('dialog', { name: 'AI' })
  const run = async (skill: string): Promise<void> => {
    await askAbout(page, 'Outro.')
    await writer.getByRole('option', { name: skill }).click()
  }

  anthropic.reply({ status: 429, retryAfter: 12 })
  await run('Proofread')
  await expect(writer.getByRole('alert')).toHaveText(
    'Too many requests right now. Try again in 12 seconds.'
  )
  await expect(page.locator(MARKS)).toHaveCount(0)
  await page.keyboard.press('Escape')

  anthropic.reply({ status: 529 })
  await run('Proofread')
  await expect(writer.getByRole('alert')).toHaveText(
    'Claude is busy right now. Try again in a moment.'
  )
  await page.keyboard.press('Escape')

  anthropic.reply({ status: 400, errorMessage: 'Your credit balance is too low.' })
  await run('Proofread')
  await expect(writer.getByRole('alert')).toHaveText(
    'Anthropic said: Your credit balance is too low.'
  )
  await page.keyboard.press('Escape')

  anthropic.reply({ text: 'Goodbye for now, everyone.', chunks: 3, drop: true })
  await run('Improve writing')
  await expect(writer.getByRole('alert')).toHaveText(
    "Can't reach Anthropic. Check your internet connection."
  )
  await expect(page.locator('.nb-ai-added')).toHaveText('Goodbye f')
  await expect(writer.getByRole('button', { name: 'Accept' })).toBeVisible()
  await writer.getByRole('button', { name: 'Undo' }).click()

  anthropic.reply({ text: '', stopReason: 'refusal' })
  await run('Proofread')
  await expect(writer.getByRole('alert')).toHaveText('Claude declined this request.')
  await page.keyboard.press('Escape')

  anthropic.reply({ status: 401 })
  await run('Proofread')
  await expect(writer.getByRole('alert')).toContainText('Your API key was rejected.')
  await writer.getByRole('button', { name: 'Open Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toContainText('Anthropic API key')
})

test('offline, AI is greyed out and Space types a space', async ({ nb }) => {
  const page = await setUp(nb)
  await page.context().setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await page.locator(editor).getByText('Intro.').click({ clickCount: 3 })
  const button = page.getByRole('button', { name: 'Ask AI' })
  await expect(button).toBeDisabled()
  await page.keyboard.press('Meta+j')
  await expect(page.getByRole('dialog', { name: 'AI' })).toBeHidden()
  await button.hover()
  await expect(page.getByText('AI is unavailable offline')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await expect(page.getByRole('dialog', { name: 'AI' })).toBeHidden()
  await expect.poll(() => blockText(page, 1)).toBe(' ')

  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Space')
  await expect(page.getByRole('dialog', { name: 'AI' })).toBeVisible()
})

test('leaving the page while Claude writes removes the change', async ({ nb, anthropic }) => {
  const page = await setUp(nb)
  const before = await readFile(join(nb.workspace, 'Notes.md'), 'utf8')
  anthropic.reply({ text: 'A rewrite in progress.', chunks: 4, hold: true })
  await askAbout(page, 'Outro.')
  await page
    .getByRole('dialog', { name: 'AI' })
    .getByRole('option', { name: 'Improve writing' })
    .click()
  await expect(page.locator('.nb-ai-added')).toBeVisible()

  await clickMenuItem(nb.app, 'New Tab')
  await page.getByTestId('sidebar-row-Other').click()
  await page.getByTestId('tab-Notes').click()
  await expect(page.locator('.tab-pane.active .nb-ai-added')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'AI' })).toBeHidden()
  await expect(page.locator('.tab-pane.active ' + editor)).toContainText('Outro.')
  await expect.poll(() => anthropic.streaming).toBe(0)
  anthropic.release()
  await expect(page.locator(MARKS)).toHaveCount(0)
  await expect(page.locator('.tab-pane.active ' + editor)).toContainText('Outro.')
  await expect(page.locator('.tab-pane.active ' + editor)).not.toContainText('A rewrite')
  expect(await readFile(join(nb.workspace, 'Notes.md'), 'utf8')).toBe(before)
})

test('closing the tab while Claude writes removes the change', async ({ nb, anthropic }) => {
  const page = await setUp(nb)
  const before = await readFile(join(nb.workspace, 'Notes.md'), 'utf8')
  await clickMenuItem(nb.app, 'New Tab')
  await page.getByTestId('sidebar-row-Other').click()
  await page.getByTestId('tab-Notes').click()
  anthropic.reply({ text: 'A rewrite in progress.', chunks: 4, hold: true })
  await askAbout(page, 'Outro.')
  await page
    .getByRole('dialog', { name: 'AI' })
    .getByRole('option', { name: 'Improve writing' })
    .click()
  await expect(page.locator('.nb-ai-added')).toBeVisible()

  await clickMenuItem(nb.app, 'Close Tab')
  await expect(page.getByTestId('tab-Notes')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'AI' })).toBeHidden()
  await expect.poll(() => anthropic.streaming).toBe(0)
  anthropic.release()
  expect(await readFile(join(nb.workspace, 'Notes.md'), 'utf8')).toBe(before)
  await page.getByTestId('sidebar-row-Notes').click()
  const pane = page.locator('.tab-pane.active ' + editor)
  await expect(pane).toContainText('Outro.')
  await expect(pane).not.toContainText('A rewrite')
  await expect(page.locator(MARKS)).toHaveCount(0)
})

test('nothing is marked before the first text arrives', async ({ nb, anthropic }) => {
  const page = await setUp(nb)
  const writer = page.getByRole('dialog', { name: 'AI' })
  anthropic.reply({ text: '', hold: true })
  await askAbout(page, 'Outro.')
  await writer.getByRole('option', { name: 'Improve writing' }).click()
  await expect(writer.getByRole('button', { name: 'Stop' })).toBeVisible()
  await expect.poll(() => anthropic.streaming).toBe(1)
  await expect(page.locator(MARKS)).toHaveCount(0)
  await writer.getByRole('button', { name: 'Stop' }).click()
  await expect(writer.getByRole('button', { name: 'Stop' })).toBeHidden()
  await expect(page.locator(MARKS)).toHaveCount(0)
  await expect(page.locator(editor)).toContainText('Outro.')

  anthropic.reply({ text: 'Goodbye.' })
  await writer.getByRole('option', { name: 'Proofread' }).click()
  await expect(page.locator('.nb-ai-removed')).toHaveText('Outro.')
  await expect(page.locator('.nb-ai-added')).toHaveText('Goodbye.')
})

test('quitting while Claude writes keeps the page as it was', async ({ nb, anthropic }) => {
  const page = await setUp(nb)
  const before = await readFile(join(nb.workspace, 'Notes.md'), 'utf8')
  await page.locator(editor).getByText('Intro.').click()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type(' Typed.')
  anthropic.reply({ text: 'A rewrite in progress.', chunks: 4, hold: true })
  await askAbout(page, 'Outro.')
  await page
    .getByRole('dialog', { name: 'AI' })
    .getByRole('option', { name: 'Improve writing' })
    .click()
  await expect(page.locator('.nb-ai-added')).toBeVisible()

  const again = await nb.relaunch()
  const saved = await readFile(join(nb.workspace, 'Notes.md'), 'utf8')
  expect(saved).toBe(before.replace('Intro.', 'Intro. Typed.'))
  await again.getByTestId('sidebar-row-Notes').click()
  await expect(again.locator(editor)).toContainText('Outro.')
  await expect(again.locator(editor)).not.toContainText('A rewrite')
})

test('with AI turned off in Settings, nothing in the editor offers it', async ({ nb }) => {
  const page = await setUp(nb)
  await clickMenuItem(nb.app, 'Settings…')
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'AI' }).click()
  await page.getByRole('switch', { name: 'Show AI in the editor' }).click()
  await page.keyboard.press('Escape')

  await page.locator(editor).getByText('Intro.').click({ clickCount: 3 })
  await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask AI' })).toHaveCount(0)
  await page.keyboard.press('Meta+j')
  await expect(page.getByRole('dialog', { name: 'AI' })).toBeHidden()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-is-empty-and-focused]')).toHaveCSS(
    'content',
    /Press ‘\/’ for commands…/,
    { pseudo: 'after' }
  )
  await page.keyboard.press('Space')
  await expect(page.getByRole('dialog', { name: 'AI' })).toBeHidden()
  await expect.poll(() => blockText(page, 1)).toBe(' ')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('/ai')
  await expect(page.getByRole('option', { name: /Ask AI/ })).toHaveCount(0)
})

test('the Writer and its diff look right in light and dark', async ({ nb, anthropic }) => {
  const page = await setUp(nb)
  await nb.app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'light'
  })
  anthropic.reply({ text: 'Goodbye.' })
  await askAbout(page, 'Outro.')
  const writer = page.getByRole('dialog', { name: 'AI' })
  await writer.getByRole('option', { name: 'Improve writing' }).click()
  await expect(writer.getByRole('button', { name: 'Accept' })).toBeVisible()
  await expect(writer).toHaveCSS('border-radius', '12px')
  await expect(writer).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('.nb-ai-added')).toHaveCSS(
    'background-color',
    'rgba(35, 131, 226, 0.1)'
  )
  await expect(page.locator('.nb-ai-removed')).toHaveCSS('color', 'rgb(212, 76, 71)')
  await expect(page.locator('.nb-ai-removed')).toHaveCSS('text-decoration-line', 'line-through')
  await expect(writer.getByRole('button', { name: 'Accept' })).toHaveCSS(
    'background-color',
    'rgb(35, 131, 226)'
  )

  await clickMenuItem(nb.app, 'Toggle Dark Mode')
  await expect(writer).toHaveCSS('background-color', 'rgb(32, 32, 32)')
  await expect(writer).toHaveCSS('box-shadow', /rgb\(56, 56, 54\) 0px 0px 0px 1px/)
  await expect(page.locator('.nb-ai-added')).toHaveCSS(
    'background-color',
    'rgba(35, 131, 226, 0.18)'
  )
  await expect(page.locator('.nb-ai-removed')).toHaveCSS('color', 'rgb(223, 84, 82)')
})

test('Cmd+J on a clicked image writes below it, and never into it', async ({ nb, anthropic }) => {
  await mkdir(join(nb.workspace, 'attachments'), { recursive: true })
  await writeFile(
    join(nb.workspace, 'attachments', 'pic.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="teal"/></svg>'
  )
  const page = await setUp(nb, 'Intro.\n\n![](attachments/pic.svg)\n\nOutro.\n')
  const writer = page.getByRole('dialog', { name: 'AI' })
  await page.locator(`${editor} img`).click()
  await page.keyboard.press('Meta+j')
  await expect(writer.getByRole('option').first()).toHaveText('Continue writing')

  anthropic.reply({ text: 'A teal box.' })
  await writer.getByRole('option', { name: 'Continue writing' }).click()
  await expect(page.locator('.nb-ai-added-block')).toHaveText('A teal box.')
  const sent = (anthropic.messages()[0].messages as { content: { text: string }[] }[])[0]
  expect(sent.content[0].text).toContain('Intro.\n\n[image]\n\n⟦cursor⟧\n\nOutro.')
  await writer.getByRole('button', { name: 'Accept' }).click()
  await expect(writer).toBeHidden()
  await expect(page.locator('.bn-block-content')).toHaveCount(4)
  await expect(page.locator('.bn-block-content').nth(1)).toHaveAttribute(
    'data-content-type',
    'image'
  )
  await expect.poll(() => blockText(page, 2)).toBe('A teal box.')
})

test('the Writer lines up with the page column when the page starts with columns', async ({
  nb
}) => {
  const toggle = '<details>\n<summary>Left.</summary>\n\nInside.\n\n</details>'
  const page = await setUp(nb, `${columnsOf(toggle, 'Right.')}Intro.\n\nOutro.\n`)
  const writer = page.getByRole('dialog', { name: 'AI' })
  await askAbout(page, 'Outro.')
  await expect(writer).toBeVisible()
  const column = await page
    .locator('.bn-block-content', { hasText: 'Outro.' })
    .evaluate((el) => el.getBoundingClientRect().left)
  const box = await writer.boundingBox()
  expect(Math.abs(box!.x - column)).toBeLessThan(1)
})

test('an answer the page cannot take ends with an error and keeps the change under review', async ({
  nb,
  anthropic
}) => {
  const page = await setUp(nb, `${columnsOf('Left.', 'Right.')}Outro.\n`)
  const writer = page.getByRole('dialog', { name: 'AI' })
  const box = writer.getByRole('textbox', { name: 'Ask AI' })
  // Columns cannot go inside a column.
  const unplaceable = { text: columnsOf('A', 'B') }

  anthropic.reply(unplaceable)
  await askAbout(page, 'Left.')
  await writer.getByRole('option', { name: 'Proofread' }).click()
  await expect(writer.getByRole('alert')).toHaveText('The answer could not be placed here.')
  await expect(writer.getByRole('button', { name: 'Stop' })).toBeHidden()
  await expect(page.locator(MARKS)).toHaveCount(0)
  await expect(page.locator(editor)).toContainText('Left.')

  anthropic.reply({ text: 'Goodbye.\n\nFor now.' }, unplaceable)
  await writer.getByRole('option', { name: 'Improve writing' }).click()
  await expect(page.locator('.nb-ai-added-block')).toHaveText(['Goodbye.', 'For now.'])
  await expect(page.locator('.nb-ai-removed-block')).toHaveText(['Left.'])
  await box.fill('as columns')
  await box.press('Enter')
  await expect(writer.getByRole('alert')).toHaveText('The answer could not be placed here.')
  await expect(page.locator('.nb-ai-added-block')).toHaveText(['Goodbye.', 'For now.'])
  await writer.getByRole('button', { name: 'Accept' }).click()
  await expect(writer).toBeHidden()
  await expect.poll(() => blockText(page, 0)).toBe('Goodbye.')
  await expect.poll(() => blockText(page, 2)).toBe('Right.')
  await waitForFile(join(nb.workspace, 'Notes.md'), 'For now.')
})
