import { Text } from '../../../ui'
import type { DayWidgetProps } from '../widgets'

function formatTime(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''
  return new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

/* Sample widget proving the board contract: shows the next upcoming event
 * (or a quiet line when the day is done). */
export function UpNextWidget({ events, now }: DayWidgetProps): React.JSX.Element {
  const upcoming = events
    .filter((event) => Date.parse(event.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0]
  if (!upcoming) {
    return (
      <Text variant="control" tone="faint">
        Day is clear
      </Text>
    )
  }
  const started = Date.parse(upcoming.start) <= now
  return (
    <div className="moki-day-widget-body">
      <Text variant="small" tone="faint">
        {started ? 'Now' : formatTime(upcoming.start)}
      </Text>
      <Text variant="title">{upcoming.title}</Text>
      <Text variant="control" tone="faint">
        {`${formatTime(upcoming.start)} – ${formatTime(upcoming.end)}`}
      </Text>
    </div>
  )
}
