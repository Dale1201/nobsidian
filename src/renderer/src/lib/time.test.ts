import { describe, expect, it } from 'vitest'
import { timeAgo, versionLabel, versionLabels } from './time'

const now = new Date(2026, 9, 21, 15, 0)
const at = (...args: [number, number, number, number, number]): string =>
  new Date(...args).toISOString()

describe('versionLabel', () => {
  it('names today and yesterday, and drops the year only within this year', () => {
    expect(versionLabel(at(2026, 9, 21, 14, 3), now)).toBe('Today, 2:03 PM')
    expect(versionLabel(at(2026, 9, 20, 9, 12), now)).toBe('Yesterday, 9:12 AM')
    expect(versionLabel(at(2026, 9, 12, 9, 12), now)).toBe('Oct 12, 9:12 AM')
    expect(versionLabel(at(2025, 11, 31, 23, 59), now)).toBe('Dec 31, 2025, 11:59 PM')
  })
})

describe('versionLabels', () => {
  it('adds seconds only where a label would read the same as its neighbor', () => {
    const labels = versionLabels(
      [
        at(2026, 9, 21, 14, 3),
        new Date(2026, 9, 21, 13, 16, 42).toISOString(),
        new Date(2026, 9, 21, 13, 16, 5).toISOString(),
        at(2026, 9, 20, 9, 12)
      ],
      now
    )
    expect(labels).toEqual([
      'Today, 2:03 PM',
      'Today, 1:16:42 PM',
      'Today, 1:16:05 PM',
      'Yesterday, 9:12 AM'
    ])
  })
})

describe('timeAgo', () => {
  it('counts minutes, hours and calendar days', () => {
    expect(timeAgo(at(2026, 9, 21, 14, 59), now)).toBe('1 minute ago')
    expect(timeAgo(now.toISOString(), now)).toBe('Just now')
    expect(timeAgo(at(2026, 9, 21, 14, 20), now)).toBe('40 minutes ago')
    expect(timeAgo(at(2026, 9, 21, 12, 0), now)).toBe('3 hours ago')
    expect(timeAgo(at(2026, 9, 20, 9, 0), now)).toBe('Yesterday')
    expect(timeAgo(at(2026, 9, 17, 9, 0), now)).toBe('4 days ago')
  })
})
