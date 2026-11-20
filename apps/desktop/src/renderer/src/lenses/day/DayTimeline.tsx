import { useMemo } from 'react'
import { Text } from '../../ui'
import type { DayEvent } from './dayEvents'

/* Visible window for the horizontal timeline (local hours). */
export const TIMELINE_START_HOUR = 6
export const TIMELINE_END_HOUR = 22

interface PlacedEvent extends DayEvent {
  startMs: number
  endMs: number
}

function placedOn(events: DayEvent[], day: Date): PlacedEvent[] {
  return events
    .map((event) => ({ ...event, startMs: Date.parse(event.start), endMs: Date.parse(event.end) }))
    .filter((event) => !Number.isNaN(event.startMs) && !Number.isNaN(event.endMs))
    .sort((a, b) => a.startMs - b.startMs)
    .filter((event) => {
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
      const dayEnd = dayStart + 86_400_000
      return event.endMs > dayStart && event.startMs < dayEnd
    })
}

/* Fraction (0..1) of an ms timestamp across the visible window. */
export function timelineFraction(ms: number, day: Date): number {
  const start = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    TIMELINE_START_HOUR,
    0,
    0,
    0
  ).getTime()
  const span = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 3_600_000
  return Math.min(1, Math.max(0, (ms - start) / span))
}

function formatTick(hour: number): string {
  const label = new Date(2026, 0, 1, hour).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
  return label.replace(/\s/g, '').toLowerCase()
}

/* Horizontal timeline: hour ticks with event pills placed by start time and
 * sized by duration, plus a now marker. */
export function DayTimeline({ events, now }: { events: DayEvent[]; now: number }): React.JSX.Element {
  const day = useMemo(() => new Date(now), [now])
  const placed = useMemo(() => placedOn(events, day), [events, day])
  const ticks = useMemo(() => {
    const hours: number[] = []
    for (let hour = TIMELINE_START_HOUR; hour <= TIMELINE_END_HOUR; hour += 2) hours.push(hour)
    return hours
  }, [])
  const nowFraction = timelineFraction(now, day)

  return (
    <section className="moki-day-timeline" aria-label="Today's timeline" data-testid="day-timeline">
      <div className="moki-day-timeline-track">
        {ticks.map((hour, index) => (
          <div
            key={hour}
            className="moki-day-timeline-tick"
            style={{
              left: `${timelineFraction(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).getTime(), day) * 100}%`,
              /* The final tick sits at 100%: inset its label so "10pm"
               * doesn't clip and force a scrollbar. */
              ...(index === ticks.length - 1 ? { transform: 'translateX(-100%)' } : null)
            }}
          >
            <Text variant="small" tone="faint">
              {formatTick(hour)}
            </Text>
          </div>
        ))}
        {placed.length === 0 ? (
          <Text variant="control" tone="faint" className="moki-day-timeline-empty">
            No events today
          </Text>
        ) : (
          placed.map((event) => {
            const left = timelineFraction(event.startMs, day) * 100
            const width = Math.max(4, (timelineFraction(event.endMs, day) - timelineFraction(event.startMs, day)) * 100)
            return (
              <div
                key={event.id}
                className="moki-day-timeline-pill"
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${event.title} ${formatPillTime(event.startMs)}`}
                data-testid={`timeline-event-${event.id}`}
              >
                <Text variant="small" tone="muted" className="moki-day-timeline-pill-text">
                  {event.title}
                </Text>
              </div>
            )
          })
        )}
        {nowFraction > 0 && nowFraction < 1 && (
          <div
            className="moki-day-timeline-now"
            style={{ left: `${nowFraction * 100}%` }}
            data-testid="timeline-now"
          />
        )}
      </div>
    </section>
  )
}

function formatPillTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}
