import { describe, expect, it } from 'vitest'
import { formatListDate } from './formatListDate'

// Wed Nov 18 2026, noon local: yesterday is Tue, six days back is Thu Nov 12,
// seven days back (older) is Wed Nov 11. Every case pins `now` explicitly —
// no wall-clock reads, so the suite is deterministic in any time zone.
const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime()

describe('formatListDate', () => {
  it('renders today as clock time', () => {
    expect(formatListDate(new Date(2026, 10, 18, 9, 4, 0), NOW)).toBe('9:04 AM')
    expect(formatListDate(new Date(2026, 10, 18, 15, 4, 0), NOW)).toBe('3:04 PM')
    expect(formatListDate(NOW, NOW)).toBe('12:00 PM')
  })

  it('reads slightly future timestamps on the same day as today (server clock skew)', () => {
    expect(formatListDate(new Date(2026, 10, 18, 12, 0, 30), NOW)).toBe('12:00 PM')
  })

  it('does not swallow future beyond today as clock time', () => {
    const tomorrow = formatListDate(new Date(2026, 10, 19, 9, 4, 0), NOW)
    const today = formatListDate(new Date(2026, 10, 18, 9, 4, 0), NOW)
    expect(tomorrow).not.toBe(today)
    expect(tomorrow).toBe('Nov 19, AM')
  })

  it('renders far-future dates as dated strings', () => {
    expect(formatListDate(new Date(2026, 11, 25, 9, 4, 0), NOW)).toBe('Dec 25, AM')
  })

  it('names yesterday with its clock time', () => {
    expect(formatListDate(new Date(2026, 10, 17, 15, 4, 0), NOW)).toBe(
      'Yesterday, 3:04 PM'
    )
    expect(formatListDate(new Date(2026, 10, 17, 9, 4, 0), NOW)).toBe('Yesterday, 9:04 AM')
  })

  it('names weekdays within six days with their clock time', () => {
    expect(formatListDate(new Date(2026, 10, 15, 10, 10, 0), NOW)).toBe('Sun 10:10 AM')
    expect(formatListDate(new Date(2026, 10, 12, 9, 5, 0), NOW)).toBe('Thu 9:05 AM')
  })

  it('renders older dates as month-day plus meridiem', () => {
    // Seven days back is past the weekday window.
    expect(formatListDate(new Date(2026, 10, 11, 9, 5, 0), NOW)).toBe('Nov 11, AM')
    expect(formatListDate(new Date(2026, 10, 3, 21, 30, 0), NOW)).toBe('Nov 3, PM')
  })

  it('renders other years numerically with the meridiem', () => {
    expect(formatListDate(new Date(2025, 0, 5, 9, 0, 0), NOW)).toBe('1/5/25, AM')
    expect(formatListDate(new Date(2024, 5, 15, 18, 0, 0), NOW)).toBe('6/15/24, PM')
  })

  it('accepts Date and ISO-string inputs', () => {
    const date = new Date(2026, 10, 18, 9, 4, 0)
    expect(formatListDate(date, NOW)).toBe('9:04 AM')
    expect(formatListDate(date.toISOString(), NOW)).toBe('9:04 AM')
  })

  it('returns an empty string for unparseable dates', () => {
    expect(formatListDate('not-a-date', NOW)).toBe('')
  })
})
