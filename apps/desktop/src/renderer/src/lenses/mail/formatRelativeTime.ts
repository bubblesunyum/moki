// Relative time for message rows (brief §4): today -> 1h/3h (5m under an
// hour, now under a minute), yesterday..6 days -> weekday (Sun/Mon), older
// -> "Nov 3". Day boundaries are local calendar days.

export function formatRelativeTime(
  value: string | number | Date,
  now: number = Date.now()
): string {
  const time =
    value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value
  if (Number.isNaN(time)) return ''
  const diffMs = now - time
  // More than a minute ahead is not "soon": pin it to an absolute date so
  // skewed helper clocks never render a future "3h".
  if (diffMs < -60_000) return formatAbsoluteDate(time, now)
  if (diffMs < 60_000) return 'now'
  const date = new Date(time)
  const nowDate = new Date(now)
  if (isSameDay(date, nowDate)) {
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`
    return `${Math.floor(diffMs / 3_600_000)}h`
  }
  if (calendarDayDiff(date, nowDate) <= 6) {
    return date.toLocaleDateString('en-US', { weekday: 'short' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/* Absolute date for future timestamps (and the shared older-date shape):
 * "Nov 20" this year, "Jan 1, 2027" otherwise. */
function formatAbsoluteDate(time: number, now: number): string {
  const date = new Date(time)
  if (date.getFullYear() === new Date(now).getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function calendarDayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000)
}
