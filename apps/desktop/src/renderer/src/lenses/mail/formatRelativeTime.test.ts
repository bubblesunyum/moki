import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './formatRelativeTime'

// Wed Nov 18 2026, noon local: yesterday is Tue, six days back is Thu Nov 12.
const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime()

describe('formatRelativeTime', () => {
  it('says now under a minute, including the near future', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('now')
    expect(formatRelativeTime(NOW, NOW)).toBe('now')
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe('now')
  })

  it('pins future dates beyond a minute to absolute dates', () => {
    // Later today, same year: month and day, no year.
    expect(formatRelativeTime(NOW + 2 * 60_000, NOW)).toBe('Nov 18')
    expect(formatRelativeTime(new Date(2026, 11, 25, 9, 0, 0), NOW)).toBe('Dec 25')
    // Another year carries the year.
    expect(formatRelativeTime(new Date(2027, 0, 1, 9, 0, 0), NOW)).toBe('Jan 1, 2027')
    expect(formatRelativeTime('2027-06-15T09:00:00.000Z', NOW)).toBe('Jun 15, 2027')
  })

  it('counts minutes under an hour', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe('1m')
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m')
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59m')
  })

  it('counts hours earlier today', () => {
    expect(formatRelativeTime(NOW - 70 * 60_000, NOW)).toBe('1h')
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h')
  })

  it('accepts Date and ISO-string inputs', () => {
    expect(formatRelativeTime(new Date(NOW - 3_600_000), NOW)).toBe('1h')
    expect(formatRelativeTime(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe('1h')
  })

  it('names the weekday from yesterday through six days back', () => {
    expect(formatRelativeTime(new Date(2026, 10, 17, 10, 0, 0), NOW)).toBe('Tue')
    expect(formatRelativeTime(new Date(2026, 10, 15, 10, 0, 0), NOW)).toBe('Sun')
    expect(formatRelativeTime(new Date(2026, 10, 12, 10, 0, 0), NOW)).toBe('Thu')
  })

  it('falls back to month and day for older threads', () => {
    expect(formatRelativeTime(new Date(2026, 10, 3, 9, 0, 0), NOW)).toBe('Nov 3')
  })

  it('returns an empty string for unparseable dates', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('')
  })
})
