import { useEffect, useState } from 'react'
import { callBridge } from '../../../rpc/bridge'
import { FIXTURE_DAY_RANGE, isUsableDayPayload, type DayEvent } from '../dayEvents'

/* The window for one local date plus `spanDays - 1` following days (the
 * Today/Tomorrow/Week control). Single days query midnight to midnight. */
export function useCalendarEvents(day: Date, spanDays = 1): { events: DayEvent[]; source: 'live' | 'fixture' } {
  const span = Math.max(1, Math.floor(spanDays))
  const dayKey = dayKeyOf(day, span)
  const [events, setEvents] = useState<DayEvent[]>(() => FIXTURE_DAY_RANGE(day, span))
  const [source, setSource] = useState<'live' | 'fixture'>('fixture')

  useEffect(() => {
    /* Reset to fresh fixtures for the new window synchronously, before the
     * bridge resolves, so a range switch never flashes yesterday's pills. */
    const { day, span } = dayFromKey(dayKey)
    setEvents(FIXTURE_DAY_RANGE(day, span))
    setSource('fixture')
    let cancelled = false
    const { timeMin, timeMax } = rangeBounds(dayKey)
    callBridge('calendar.listEvents', { timeMin, timeMax })
      .then((raw) => {
        if (cancelled) return
        if (isUsableDayPayload(raw)) {
          setEvents(raw.events)
          setSource('live')
        } else {
          /* Usable live data never arrived: fixtures are already in place
           * for the current window from the synchronous reset above. */
          setEvents(FIXTURE_DAY_RANGE(day, span))
          setSource('fixture')
        }
      })
      .catch(() => {
        /* Helper down or accounts failing: fixtures stay, rebuilt for the
         * current window for the same midnight reason. */
        if (cancelled) return
        setEvents(FIXTURE_DAY_RANGE(day, span))
        setSource('fixture')
      })
    return () => {
      cancelled = true
    }
  }, [dayKey])

  return { events, source }
}

function dayKeyOf(day: Date, span: number): string {
  return `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}+${span}`
}

function dayFromKey(dayKey: string): { day: Date; span: number } {
  const [datePart, spanPart] = dayKey.split('+')
  const [year, month, date] = (datePart ?? '').split('-').map(Number)
  return { day: new Date(year, month, date), span: Math.max(1, Number(spanPart) || 1) }
}

/* Local-window bounds as ISO strings for the RPC window. */
function rangeBounds(dayKey: string): { timeMin: string; timeMax: string } {
  const { day, span } = dayFromKey(dayKey)
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0)
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + span, 0, 0, 0, 0)
  return { timeMin: start.toISOString(), timeMax: end.toISOString() }
}
