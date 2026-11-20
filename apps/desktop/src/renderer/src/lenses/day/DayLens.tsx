import { DayHeader } from './DayHeader'
import { DayTimeline } from './DayTimeline'
import { WidgetGrid } from './WidgetGrid'
import { useCalendarEvents } from './hooks/useCalendarEvents'
import { useNow } from './hooks/useNow'
import './DayLens.css'

/* Day lens: date/time header, horizontal event timeline, widget board.
 * Calendar data goes through useCalendarEvents, which falls back to fixture
 * events when the helper is down or every account fails. */
export function DayLens(): React.JSX.Element {
  const now = useNow()
  const { events } = useCalendarEvents(new Date(now))
  return (
    <div className="moki-day-lens" data-testid="day-lens">
      <DayHeader now={now} />
      <DayTimeline events={events} now={now} />
      <WidgetGrid events={events} now={now} />
    </div>
  )
}
