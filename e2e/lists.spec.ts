import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { editor, openFile } from './helpers'

const markers = (page: Page, type: string): Promise<string[]> =>
  page.evaluate(
    (t) =>
      [...document.querySelectorAll(`.bn-editor .bn-block-content[data-content-type="${t}"]`)].map(
        (el) => getComputedStyle(el, '::before').content
      ),
    type
  )

test('nested blocks have no guide line', async ({ nb }) => {
  const page = await openFile(nb, 'Nested', '- one\n  - two\n    - three\n')
  const borders = await page.evaluate(() =>
    [...document.querySelectorAll('.bn-editor .bn-block-outer')].map(
      (el) => getComputedStyle(el, '::before').borderLeftStyle
    )
  )
  expect(borders.length).toBeGreaterThan(2)
  expect(borders.every((b) => b === 'none')).toBe(true)
})

test('bullets change shape with depth and repeat', async ({ nb }) => {
  const page = await openFile(nb, 'Bullets', '- a\n  - b\n    - c\n      - d\n')
  expect(await markers(page, 'bulletListItem')).toEqual(['"•"', '"◦"', '"▪"', '"•"'])
})

test('numbered lists go 1. a. i. by depth and keep their start', async ({ nb }) => {
  const page = await openFile(
    nb,
    'Numbers',
    '1. a\n2. b\n   1. c\n   2. d\n      1. e\n\nbreak\n\n3. x\n4. y\n'
  )
  expect(await markers(page, 'numberedListItem')).toEqual([
    '"1."',
    '"2."',
    '"a."',
    '"b."',
    '"i."',
    '"3."',
    '"4."'
  ])
})

test('list markers sit in a 24px column like Notion', async ({ nb }) => {
  const page = await openFile(nb, 'Column', '- item\n')
  const box = await page.evaluate(() => {
    const el = document.querySelector('.bn-editor [data-content-type="bulletListItem"]')!
    const s = getComputedStyle(el, '::before')
    return {
      width: s.width,
      fontSize: s.fontSize,
      marginLeft: s.marginLeft,
      marginRight: s.marginRight
    }
  })
  expect(box).toEqual({ width: '24px', fontSize: '24px', marginLeft: '2px', marginRight: '6px' })
})

test('checkboxes are drawn like Notion', async ({ nb }) => {
  const page = await openFile(nb, 'Todos', '- [ ] open\n- [x] done\n')
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('.bn-editor [data-content-type="checkListItem"] input')].map(
      (el) => {
        const s = getComputedStyle(el)
        return { appearance: s.appearance, width: s.width, height: s.height, bg: s.backgroundColor }
      }
    )
  )
  expect(boxes[0]).toMatchObject({ appearance: 'none', width: '16px', height: '16px' })
  expect(boxes[1].bg).toBe('rgb(39, 131, 222)')
  const done = await page.evaluate(() => {
    const el = document.querySelector(
      '.bn-editor [data-content-type="checkListItem"][data-checked="true"] .bn-inline-content'
    )!
    const s = getComputedStyle(el)
    return { opacity: s.opacity, line: s.textDecorationLine }
  })
  expect(done).toEqual({ opacity: '0.7', line: 'line-through' })
})

test('an empty toggle says how to fill it', async ({ nb }) => {
  const page = await openFile(nb, 'Toggle', '<details>\n<summary>Open me</summary>\n\n</details>\n')
  await page.locator(`${editor} .bn-toggle-button`).click()
  await expect(page.locator(`${editor} .bn-toggle-add-block-button`)).toHaveText(
    'Empty toggle. Click or drop blocks inside.'
  )
})

test('children line up under the text of their list item', async ({ nb }) => {
  const page = await openFile(nb, 'Indent', '- parent\n  - child\n- [ ] task\n  - under task\n')
  const lefts = await page.evaluate(() => {
    const textLeft = (text: string): number => {
      const el = [...document.querySelectorAll('.bn-editor .bn-inline-content')].find(
        (e) => e.textContent === text
      )!
      return Math.round(el.getBoundingClientRect().left)
    }
    const markerLeft = (text: string): number => {
      const el = [...document.querySelectorAll('.bn-editor .bn-block-content')].find(
        (e) => e.textContent === text
      )!
      return Math.round(el.getBoundingClientRect().left)
    }
    return {
      parentText: textLeft('parent'),
      childBlock: markerLeft('child'),
      taskText: textLeft('task'),
      underTaskBlock: markerLeft('under task')
    }
  })
  // Notion starts a child where the parent's marker column ends: 26px, 6px before the text.
  expect(lefts.childBlock).toBe(lefts.parentText - 6)
  expect(lefts.underTaskBlock).toBe(lefts.taskText - 6)
})
