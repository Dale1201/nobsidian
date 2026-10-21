import { describe, expect, it } from 'vitest'
import { relativeHref, resolveHref, sanitizeTitle, encodeHref, isExternalHref } from './paths'
import { parsePage, serializePage } from './page'

describe('paths', () => {
  it('sanitizes titles for filenames', () => {
    expect(sanitizeTitle('A/B: C?')).toBe('A-B- C-')
    expect(sanitizeTitle('.hidden')).toBe('-hidden')
    expect(sanitizeTitle('   ')).toBe('Untitled')
    expect(sanitizeTitle('a\\b')).toBe('a-b')
    expect(sanitizeTitle('🚀 Launch')).toBe('🚀 Launch')
  })

  it('resolves and relativizes hrefs', () => {
    expect(resolveHref('Projects/Plan.md', '../attachments/a%20b.png')).toBe('attachments/a b.png')
    expect(resolveHref('Plan.md', 'Plan/Child.md')).toBe('Plan/Child.md')
    expect(relativeHref('Projects/Plan.md', 'attachments/a b.png')).toBe('../attachments/a%20b.png')
    expect(relativeHref('Projects.md', 'Projects/Web.md')).toBe('Projects/Web.md')
    expect(relativeHref('A/B/C.md', 'A/D.md')).toBe('../D.md')
    expect(encodeHref('My Notes/🚀.md')).toBe('My%20Notes/%F0%9F%9A%80.md')
  })

  it('detects external hrefs', () => {
    expect(isExternalHref('https://x.dev')).toBe(true)
    expect(isExternalHref('mailto:a@b.c')).toBe(true)
    expect(isExternalHref('nobsidian://page/1')).toBe(true)
    expect(isExternalHref('#top')).toBe(true)
    expect(isExternalHref('Other.md')).toBe(false)
  })
})

describe('page files', () => {
  it('round-trips frontmatter and keeps unknown keys', () => {
    const text = '---\nid: abc\ntitle: A/B\nicon: 🚀\ntags:\n  - x\n---\n\nHello\n'
    const page = parsePage(text)
    expect(page.meta).toEqual({ id: 'abc', title: 'A/B', icon: '🚀', extra: { tags: ['x'] } })
    expect(serializePage(page.meta, page.blocks)).toBe(text)
  })

  it('keeps invalid frontmatter as body text', () => {
    const page = parsePage('---\nid: [oops\n---\nBody\n')
    expect(page.meta).toEqual({ extra: {} })
    expect(page.blocks.length).toBeGreaterThan(0)
  })

  it('reads files saved with Windows line endings', () => {
    const page = parsePage('---\r\nid: a\r\n---\r\n\r\nHi\r\n')
    expect(page.meta.id).toBe('a')
    expect(page.blocks).toEqual([
      {
        type: 'paragraph',
        props: {},
        content: [{ type: 'text', text: 'Hi', styles: {} }],
        children: []
      }
    ])
  })

  it('handles files without frontmatter', () => {
    expect(parsePage('Just text\n').meta).toEqual({ extra: {} })
    expect(serializePage({ extra: {} }, [])).toBe('')
  })
})
