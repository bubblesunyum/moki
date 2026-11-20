import type { CalendarEvent } from '../../../../../../../packages/protocol/src/index'

/* DayEvent shape for the Day lens timeline and widgets. It is the
 * `calendar.listEvents` event shape, shared so live and fixture events are
 * interchangeable. */
export type DayEvent = CalendarEvent

/* Fixture spread repeated across `spanDays` local days from `start`, so the
 * week window has the same readable shape as a single day. Ids stay unique
 * per day; titles match the single-day fixtures. */
export function FIXTURE_DAY_RANGE(start: Date, spanDays: number): DayEvent[] {
  const days = Math.max(1, Math.floor(spanDays))
  const out: DayEvent[] = []
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)
    const suffix = offset === 0 ? '' : `-d${offset}`
    const at = (hour: number, minute: number, lengthMinutes: number, id: string, title: string): DayEvent => {
      const eventStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0)
      const end = new Date(eventStart.getTime() + lengthMinutes * 60_000)
      return { id: `${id}${suffix}`, title, start: eventStart.toISOString(), end: end.toISOString(), calendar: 'primary' }
    }
    out.push(
      at(9, 30, 30, 'fixture-standup', 'Standup'),
      at(12, 0, 60, 'fixture-qwell', 'QWELL'),
      at(13, 15, 45, 'fixture-lunch', 'Lunch'),
      at(15, 30, 60, 'fixture-physio', 'Physio'),
      at(18, 30, 60, 'fixture-garden', 'Garden')
    )
  }
  return out
}

/* Guard for the live RPC payload — anything off-shape keeps the fixtures.
 * unreachable/authExpired ride along per failed account (protocol), and both
 * are optional-tolerant here so older helpers still validate. */
export interface DayEventListPayload {
  events: DayEvent[]
  unreachable?: string[]
  authExpired?: string[]
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function stringListOf(value: unknown): string[] {
  return isStringList(value) ? value : []
}

export function isDayEventList(value: unknown): value is DayEventListPayload {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.events)) return false
  if (record.unreachable !== undefined && !isStringList(record.unreachable)) return false
  if (record.authExpired !== undefined && !isStringList(record.authExpired)) return false
  return record.events.every(
    (event) =>
      typeof event === 'object' &&
      event !== null &&
      typeof (event as Record<string, unknown>).id === 'string' &&
      typeof (event as Record<string, unknown>).title === 'string' &&
      typeof (event as Record<string, unknown>).start === 'string' &&
      typeof (event as Record<string, unknown>).end === 'string'
  )
}

/* A live page is usable when it names events, or when no account reports a
 * failure (empty events with no unreachable/authExpired is a genuinely empty
 * day). Zero events plus failures keeps the fixtures instead of blanking. */
export function isUsableDayPayload(value: unknown): value is DayEventListPayload {
  if (!isDayEventList(value)) return false
  if (value.events.length > 0) return true
  return (
    stringListOf(value.unreachable).length === 0 && stringListOf(value.authExpired).length === 0
  )
}
