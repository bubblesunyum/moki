// List-row dates with psymail's stringForDate semantics (explicit override of
// brief §4): today -> clock time ("3:04 PM"); yesterday -> "Yesterday, 3:04
// PM"; within six days -> weekday plus time ("Wed 3:04 PM"); older -> month
// and day plus meridiem ("Nov 3, AM"), numeric with year past January 1
// ("1/5/25, AM"). Day boundaries are local calendar days; en-US 12-hour
// clock everywhere. Same-calendar-day future timestamps read as today,
// matching psymail (mail-server clock skew); future beyond today falls
// through to the dated branches rather than pinning to a clock time.

export function formatListDate(
  value: string | number | Date,
  now: number = Date.now()
): string {
  const time =
    value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value
  if (Number.isNaN(time)) return ''
  const date = new Date(time)
  const nowDate = new Date(now)
  const clock = formatClock(date)
  const daysAgo = calendarDayDiff(date, nowDate)
  if (daysAgo === 0) return clock
  if (daysAgo === 1) return `Yesterday, ${clock}`
  if (daysAgo >= 2 && daysAgo <= 6) {
    return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${clock}`
  }
  const sameYear = date.getFullYear() === nowDate.getFullYear()
  const day = sameYear
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : date.toLocaleDateString('en-US', { year: '2-digit', month: 'numeric', day: 'numeric' })
  return `${day}, ${formatMeridiem(clock)}`
}

/* en-US 12-hour clock time: "3:04 PM". */
function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

/* Meridiem half of an already-computed clock string ("AM"/"PM"). */
function formatMeridiem(clock: string): string {
  return clock.split(' ').pop() ?? ''
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function calendarDayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000)
}
