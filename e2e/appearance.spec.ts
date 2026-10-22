import { expect, test } from './fixtures'
import { editor, openFile } from './helpers'

test('headings use Notion sizes, level 1 included', async ({ nb }) => {
  const page = await openFile(nb, 'Sizes', '# One\n\n## Two\n\n### Three\n')
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('.bn-editor [data-content-type="heading"]')].map(
      (el) => getComputedStyle(el.querySelector('h1, h2, h3') ?? el).fontSize
    )
  )
  expect(sizes).toEqual(['30px', '24px', '20px'])
})

test('a page that starts with a block without text does not open with it selected', async ({
  nb
}) => {
  const page = await openFile(nb, 'Divider first', '---\n\nAfter the divider\n')
  await expect(page.locator(editor)).toContainText('After the divider')
  const highlight = await page.evaluate(() => {
    const node = document.querySelector('.bn-editor .ProseMirror-selectednode')
    if (!node) return 'none'
    const target = node.querySelector(':scope > *') ?? node
    return getComputedStyle(target, '::after').boxShadow
  })
  expect(highlight).toBe('none')
})

test('long breadcrumb titles end with an ellipsis', async ({ nb }) => {
  const page = await openFile(
    nb,
    'A very long page title that will not fit in the breadcrumb bar',
    'Body\n'
  )
  const title = page.locator('.breadcrumb .breadcrumb-title').last()
  await expect(title).toHaveCSS('text-overflow', 'ellipsis')
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
})
