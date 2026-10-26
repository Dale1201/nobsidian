import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { GOOD_KEY } from './fakeAnthropic'
import { expect, test, type AppFixture } from './fixtures'
import { editor, waitForFile } from './helpers'

const PAGE = 'Intro.\n\nWe spent the hour arguing about launch.\n\nOutro.\n'

/** Saves the key, writes a page and opens it. */
async function setUp(nb: AppFixture, body = PAGE): Promise<Page> {
  await nb.page.evaluate((key) => window.api.invoke('ai:setKey', { key }), GOOD_KEY)
  await writeFile(join(nb.workspace, 'Notes.md'), body)
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Notes').click()
  await expect(page.locator(editor)).toContainText('Outro.')
  return page
}

const file = (nb: AppFixture): Promise<string> => readFile(join(nb.workspace, 'Notes.md'), 'utf8')

// The diff and the selection the Writer keeps; the editor itself carries nb-ai-available.
const MARKS = '.nb-ai-added, .nb-ai-removed, .nb-ai-added-block, .nb-ai-removed-block'

async function selectParagraph(page: Page, text: string): Promise<void> {
  await page.locator(editor).getByText(text).click({ clickCount: 3 })
}

test('Make shorter streams a diff into the page, saved only once accepted', async ({
  nb,
  anthropic
}) => {
  const page = await setUp(nb)
  await waitForFile(join(nb.workspace, 'Notes.md'), /^---\nid: /)
  const before = await file(nb)
  await selectParagraph(page, 'We spent the hour arguing about launch.')
  await page.getByRole('button', { name: 'Ask AI' }).click()
  const writer = page.getByRole('dialog', { name: 'AI' })
  await expect(writer.getByRole('textbox', { name: 'Ask AI' })).toBeFocused()
  await expect(writer.getByRole('textbox', { name: 'Ask AI' })).toHaveAttribute(
    'placeholder',
    'Edit with AI'
  )

  anthropic.reply({ text: 'We argued about launch.', chunks: 3, hold: true })
  await writer.getByRole('option', { name: 'Make shorter' }).click()
  await expect(page.locator('.nb-ai-added')).toHaveText('We argue')
  await expect(page.locator('.nb-ai-removed')).toHaveText('We spent the hour arguing about launch.')
  await expect(writer.getByRole('button', { name: 'Stop' })).toBeVisible()
  expect(await file(nb)).toBe(before)

  anthropic.release()
  await expect(page.locator('.nb-ai-added')).toHaveText('We argued about launch.')
  await expect(writer.getByRole('button', { name: 'Accept' })).toBeVisible()
  expect(await file(nb)).toBe(before)

  const sent = (anthropic.messages()[0].messages as { content: { text: string }[] }[])[0]
  expect(sent.content[0].text).toContain(
    '⟦selection⟧We spent the hour arguing about launch.⟦/selection⟧'
  )
  expect(sent.content[1].text).toBe(
    'Make the selection about half as long, keeping every key point.'
  )

  await writer.getByRole('button', { name: 'Accept' }).click()
  await expect(writer).toBeHidden()
  await expect(page.locator('.nb-ai-added')).toHaveCount(0)
  await waitForFile(join(nb.workspace, 'Notes.md'), 'We argued about launch.')
  expect(await file(nb)).not.toContain('spent the hour')

  await page.keyboard.press('Meta+z')
  await expect(page.locator(editor)).toContainText('We spent the hour arguing about launch.')
  await waitForFile(join(nb.workspace, 'Notes.md'), 'spent the hour')
})

test('every entry point opens the Writer, and Space only on an empty line', async ({ nb }) => {
  const page = await setUp(nb)
  const writer = page.getByRole('dialog', { name: 'AI' })

  await selectParagraph(page, 'Intro.')
  await page.keyboard.press('Meta+j')
  await expect(writer).toBeVisible()
  await expect(writer.getByRole('option')).toHaveCount(9)
  await page.keyboard.press('Escape')
  await expect(writer).toBeHidden()

  await page.locator(editor).getByText('Outro.').click()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-is-empty-and-focused]')).toHaveCSS(
    'content',
    /Press ‘space’ for AI or ‘\/’ for commands/,
    { pseudo: 'after' }
  )
  await page.keyboard.press('Space')
  await expect(writer).toBeVisible()
  await expect(writer.getByRole('option').first()).toHaveText('Continue writing')
  await page.keyboard.press('Escape')

  await page.keyboard.type('/ai')
  await page.getByRole('option', { name: /Ask AI/ }).click()
  await expect(writer).toBeVisible()
  await page.keyboard.press('Escape')

  await page.keyboard.type('x')
  await page.keyboard.press('Space')
  await expect(writer).toBeHidden()
  await expect(page.locator(editor)).toContainText('x ')
})

test('with no key, the Writer asks for one first', async ({ nb, anthropic }) => {
  await writeFile(join(nb.workspace, 'Notes.md'), PAGE)
  const page = await nb.relaunch()
  await page.getByTestId('sidebar-row-Notes').click()
  await selectParagraph(page, 'Intro.')
  await page.keyboard.press('Meta+j')
  const writer = page.getByRole('dialog', { name: 'AI' })
  await expect(writer).toContainText('Set up AI')
  await expect(writer).toContainText('Images, files, drawings and other pages are never sent.')
  await writer.getByLabel('Anthropic API key').fill(GOOD_KEY)
  await writer.getByRole('button', { name: 'Save' }).click()
  await expect(writer.getByRole('option', { name: 'Improve writing' })).toBeVisible()
  anthropic.reply({ text: 'Hello.' })
  await writer.getByRole('option', { name: 'Proofread' }).click()
  await expect(writer.getByRole('button', { name: 'Accept' })).toBeVisible()
})

test('Undo leaves no trace, Stop keeps what came, and clicking away accepts', async ({
  nb,
  anthropic
}) => {
  const page = await setUp(nb)
  await waitForFile(join(nb.workspace, 'Notes.md'), /^---\nid: /)
  const before = await file(nb)
  const writer = page.getByRole('dialog', { name: 'AI' })

  await selectParagraph(page, 'Outro.')
  await page.keyboard.press('Meta+j')
  anthropic.reply({ text: 'Goodbye.' })
  await writer.getByRole('option', { name: 'Improve writing' }).click()
  await writer.getByRole('button', { name: 'Undo' }).click()
  await expect(writer).toBeHidden()
  await expect(page.locator(editor)).toContainText('Outro.')
  await expect(page.locator(MARKS)).toHaveCount(0)
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(800)
  expect(await file(nb)).toBe(before)

  await selectParagraph(page, 'Outro.')
  await page.keyboard.press('Meta+j')
  anthropic.reply({ text: 'A much longer goodbye than before.', chunks: 4, hold: true })
  await writer.getByRole('option', { name: 'Make longer' }).click()
  await expect(page.locator('.nb-ai-added')).toHaveText('A much lo')
  await page.keyboard.press('Escape')
  await expect(writer.getByRole('button', { name: 'Stop' })).toBeVisible()
  await writer.getByRole('button', { name: 'Stop' }).click()
  await expect(writer.getByRole('button', { name: 'Accept' })).toBeVisible()
  await expect(page.locator('.nb-ai-added')).toHaveText('A much lo')

  await page.locator(editor).getByText('Intro.').click()
  await expect(writer).toBeHidden()
  await waitForFile(join(nb.workspace, 'Notes.md'), 'A much lo')
  expect(await file(nb)).not.toContain('Outro.')
})

test('Summarize inserts below, Continue writing at the cursor, Explain replies', async ({
  nb,
  anthropic
}) => {
  const page = await setUp(nb)
  const writer = page.getByRole('dialog', { name: 'AI' })

  await selectParagraph(page, 'We spent the hour arguing about launch.')
  await page.keyboard.press('Meta+j')
  anthropic.reply({ text: '- Launch slips.' })
  await writer.getByRole('option', { name: 'Summarize' }).click()
  await expect(page.locator('.nb-ai-removed, .nb-ai-removed-block')).toHaveCount(0)
  await writer.getByRole('button', { name: 'Accept' }).click()
  await expect(page.locator('.bn-block-content[data-content-type="bulletListItem"]')).toHaveText(
    'Launch slips.'
  )

  await page.locator(editor).getByText('Intro.').click()
  await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.press('Meta+j')
  anthropic.reply({ text: 'More intro.' })
  await writer.getByRole('option', { name: 'Continue writing' }).click()
  await expect(writer.getByRole('button', { name: 'Accept' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(writer).toBeHidden()
  const blocks = page.locator('.bn-block-content')
  await expect(blocks.nth(0)).toHaveText('Intro.')
  await expect(blocks.nth(1)).toHaveText('More intro.')
  const sent = (anthropic.messages()[1].messages as { content: { text: string }[] }[])[0]
  expect(sent.content[0].text).toContain('Intro.⟦cursor⟧')

  await selectParagraph(page, 'Outro.')
  await page.keyboard.press('Meta+j')
  anthropic.reply({ text: 'It ends the **notes**.' })
  await writer.getByRole('option', { name: 'Explain' }).click()
  await expect(writer.locator('.nb-writer-reply strong')).toHaveText('notes')
  await expect(page.locator(MARKS)).toHaveCount(0)
  await writer.getByRole('button', { name: 'Insert below' }).click()
  await expect(writer).toBeHidden()
  await expect(blocks.last()).toHaveText('It ends the notes.')
})

test('typed instructions edit or reply, and a follow-up revises the change', async ({
  nb,
  anthropic
}) => {
  const page = await setUp(nb)
  const writer = page.getByRole('dialog', { name: 'AI' })
  const box = writer.getByRole('textbox', { name: 'Ask AI' })

  await selectParagraph(page, 'Outro.')
  await page.keyboard.press('Meta+j')
  anthropic.reply({ tool: { name: 'reply', markdown: 'It closes the page.' } })
  await box.fill('what is this for?')
  await box.press('Enter')
  await expect(writer.locator('.nb-writer-reply')).toHaveText('It closes the page.')
  await expect(page.locator(MARKS)).toHaveCount(0)
  await page.keyboard.press('Escape')

  await selectParagraph(page, 'Outro.')
  await page.keyboard.press('Meta+j')
  anthropic.reply(
    { tool: { name: 'edit', markdown: 'The end.' } },
    { tool: { name: 'edit', markdown: 'The end of these notes.' } }
  )
  await box.fill('make it final')
  await box.press('Enter')
  await expect(page.locator('.nb-ai-added')).toHaveText('The end.')
  await box.fill('longer')
  await box.press('Enter')
  await expect(page.locator('.nb-ai-added')).toHaveText('The end of these notes.')
  const followUp = anthropic.messages()[2].messages as { role: string }[]
  expect(followUp.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  await box.press('Enter')
  await expect(writer).toBeHidden()
  await expect(page.locator(editor)).toContainText('The end of these notes.')
  await expect(page.locator(editor)).not.toContainText('Outro.')

  await selectParagraph(page, 'Intro.')
  await page.keyboard.press('Meta+j')
  await box.fill('Tra')
  await expect(writer.getByRole('option')).toHaveText(['Translate to…'])
  await box.press('Enter')
  await expect(box).toHaveValue('Translate to ')
  anthropic.reply({ text: 'Introduction.' })
  await box.pressSequentially('French')
  await box.press('Enter')
  await expect(page.locator('.nb-ai-added')).toHaveText('Introduction.')
  const translate = (anthropic.messages()[3].messages as { content: { text: string }[] }[])[0]
  expect(translate.content[1].text).toBe('Translate to French. Apply it to the selection.')
  expect(anthropic.messages()[3]).not.toHaveProperty('tools')
})
