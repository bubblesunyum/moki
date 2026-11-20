import { useEffect, useState } from 'react'
import { callBridge } from '../../../rpc/bridge'
import { FIXTURE_DAY_EVENTS, isUsableDayPayload, type DayEvent } from '../dayEvents'

/* Day's events for one local date. Tries the live `calendar.listEvents` RPC
 * and falls back to fixture events so the timeline always has something to
 * show. The guard validates the live payload at runtime — off-shape payloads
 * and zero-event pages with failing accounts keep the fixtures. */
export function useCalendarEvents(day: Date): { events: DayEvent[]; source: 'live' | 'fixture' } {
  const dayKey = dayKeyOf(day)
  const [events, setEvents] = useState<DayEvent[]>(() => FIXTURE_DAY_EVENTS(day))
  const [source, setSource] = useState<'live' | 'fixture'>('fixture')

  useEffect(() => {
    let cancelled = false
    const { timeMin, timeMax } = dayBounds(dayKey)
    callBridge('calendar.listEvents', { timeMin, timeMax })
      .then((raw) => {
        if (cancelled) return
        if (isUsableDayPayload(raw)) {
          setEvents(raw.events)
          setSource('live')
        } else {
          /* Usable live data never arrived: rebuild the fixtures for the
           * current day so a midnight flip can't leave yesterday's behind. */
          setEvents(FIXTURE_DAY_EVENTS(dayFromKey(dayKey)))
          setSource('fixture')
        }
      })
      .catch(() => {
        /* Helper down or accounts failing: fixtures stay, rebuilt for the
         * current day for the same midnight reason. */
        if (cancelled) return
        setEvents(FIXTURE_DAY_EVENTS(dayFromKey(dayKey)))
        setSource('fixture')
      })
    return () => {
      cancelled = true
    }
  }, [dayKey])

  return { events, source }
}

function dayKeyOf(day: Date): string {
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
}

function dayFromKey(dayKey: string): Date {
  const [year, month, date] = dayKey.split('-').map(Number)
  return new Date(year, month, date)
}

/* Local-day bounds as ISO strings for the RPC window. */
function dayBounds(dayKey: string): { timeMin: string; timeMax: string } {
  const [year, month, date] = dayKey.split('-').map(Number)
  const start = new Date(year, month, date, 0, 0, 0, 0)
  const end = new Date(year, month, date + 1, 0, 0, 0, 0)
  return { timeMin: start.toISOString(), timeMax: end.toISOString() }
}
