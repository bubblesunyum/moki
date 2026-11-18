import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../formatRelativeTime'
import { formatMessageDate } from './dates'

const NOW = new Date('2026-11-18T12:00:00Z').getTime()

describe('formatMessageDate', () => {
  it('renders minutes and hours', () => {
    expect(formatMessageDate(new Date(NOW - 30_000).toISOString(), NOW)).toBe('now')
    expect(formatMessageDate(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m')
    expect(formatMessageDate(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h')
  })

  it('renders weekdays within a week', () => {
    // Nov 18 2026 is a Wednesday; two days back is Monday.
    expect(formatMessageDate(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('Mon')
  })

  it('renders month and day beyond a week', () => {
    expect(formatMessageDate(new Date(NOW - 10 * 86_400_000).toISOString(), NOW)).toBe('Nov 8')
  })

  it('returns empty for invalid dates', () => {
    expect(formatMessageDate('not-a-date', NOW)).toBe('')
  })

  it('matches the shared formatter, including pinned future dates', () => {
    const samples = [
      new Date(NOW - 30_000).toISOString(),
      new Date(NOW - 5 * 60_000).toISOString(),
      new Date(NOW - 3 * 3_600_000).toISOString(),
      new Date(NOW - 2 * 86_400_000).toISOString(),
      new Date(NOW - 10 * 86_400_000).toISOString(),
      new Date(NOW + 30_000).toISOString(),
      new Date(NOW + 2 * 60_000).toISOString(),
      '2027-01-01T09:00:00.000Z',
      'not-a-date'
    ]
    for (const iso of samples) {
      expect(formatMessageDate(iso, NOW)).toBe(formatRelativeTime(iso, NOW))
    }
  })
})
