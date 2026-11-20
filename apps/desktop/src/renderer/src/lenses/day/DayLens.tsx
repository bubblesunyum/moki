import { useMemo, useState } from 'react'
import { SegmentGroup } from '../../ui'
import { DayHeader } from './DayHeader'
import { DayTimeline } from './DayTimeline'
import { WidgetGrid } from './WidgetGrid'
import { useCalendarEvents } from './hooks/useCalendarEvents'
import { useNow } from './hooks/useNow'
import './DayLens.css'

export type DayRange = 'today' | 'tomorrow' | 'week'

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'Week' }
]

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/* Capture override (dev only, via ?mokiRange= on the startup URL, mirroring
 * the shell's ?mokiLens=): an unknown value warns and keeps Today. */
function initialRange(): DayRange {
  try {
    const raw = new URLSearchParams(window.location.search).get('mokiRange')?.trim().toLowerCase()
    if (raw === null || raw === undefined || raw === '') return 'today'
    if (raw === 'today' || raw === 'tomorrow' || raw === 'week') return raw
    console.warn(`[capture] unknown MOKI_DAY_RANGE="${raw}", using Today`)
  } catch {
    /* Non-browser environment: default. */
  }
  return 'today'
}

function formatDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

/* Day lens: range control, hero, Path timeline, widget board.
 * Calendar data goes through useCalendarEvents, which falls back to fixture
 * events when the helper is down or every account fails. */
export function DayLens(): React.JSX.Element {
  const now = useNow()
  const [range, setRange] = useState<DayRange>(initialRange)
  const viewStart = useMemo(() => {
    const base = startOfDay(new Date(now))
    if (range === 'tomorrow') base.setDate(base.getDate() + 1)
    return base
  }, [now, range])
  const spanDays = range === 'week' ? 7 : 1
  const { events } = useCalendarEvents(viewStart, spanDays)

  const { title, sub, emptyLabel } = useMemo(() => {
    if (range === 'week') {
      const end = new Date(viewStart.getFullYear(), viewStart.getMonth(), viewStart.getDate() + 6)
      const sameMonth = end.getMonth() === viewStart.getMonth()
      return {
        title: 'Week',
        sub: sameMonth
          ? `${formatDay(viewStart)} – ${end.getDate()}`
          : `${formatDay(viewStart)} – ${formatDay(end)}`,
        emptyLabel: 'No events this week'
      }
    }
    return {
      title: viewStart.toLocaleDateString('en-US', { weekday: 'long' }),
      sub: formatDay(viewStart),
      emptyLabel: range === 'tomorrow' ? 'No events tomorrow' : 'No events today'
    }
  }, [range, viewStart])

  return (
    <div className="moki-day-lens" data-testid="day-lens">
      <div className="moki-day-range">
        <SegmentGroup label="Day range" value={range} onChange={(next) => setRange(next as DayRange)} options={RANGE_OPTIONS} />
      </div>
      <DayHeader now={now} title={title} sub={sub} />
      <DayTimeline events={events} now={now} viewStart={viewStart} spanDays={spanDays} emptyLabel={emptyLabel} />
      <WidgetGrid events={events} now={now} />
    </div>
  )
}
