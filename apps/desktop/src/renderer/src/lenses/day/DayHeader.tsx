import { Text } from '../../ui'

/* Day header (Figma node 313-2561 top section): weekday + date with the
 * live clock beside it. */
export function DayHeader({ now }: { now: number }): React.JSX.Element {
  const date = new Date(now)
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' })
  const rest = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return (
    <header className="moki-day-header">
      <h1 className="lens-title moki-day-header-date">{`${weekday}, ${rest}`}</h1>
      <Text variant="control" tone="faint" aria-live="off">
        {time}
      </Text>
    </header>
  )
}
