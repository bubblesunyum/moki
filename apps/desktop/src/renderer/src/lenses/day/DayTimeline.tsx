import { useMemo } from 'react'
import { Text } from '../../ui'
import type { DayEvent } from './dayEvents'

/* Visible window for a single day (local hours); week lanes each reuse the
 * same single-day window on their own date. */
export const TIMELINE_START_HOUR = 6
export const TIMELINE_END_HOUR = 22

/* Accent per chronological index (Figma Path order): violet, coral, mint,
 * amber, cyan. Week lanes restart the order per day so recurring events
 * match across days. */
const PATH_ACCENTS = ['violet', 'coral', 'mint', 'amber', 'cyan'] as const

interface PlacedEvent extends DayEvent {
  startMs: number
  endMs: number
}

export interface DayWindow {
  start: number
  end: number
}

/* Render window for one local date: 6:00 to 22:00. */
function singleDayWindow(day: Date): DayWindow {
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
  return { start, end: start + span }
}

/* Fetch bounds for `spanDays` local days from `day`: midnight to midnight
 * via calendar arithmetic (never raw ms, so DST boundaries stay aligned). */
function rangeBounds(day: Date, spanDays: number): DayWindow {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + spanDays).getTime()
  return { start, end }
}

/* Events overlapping a window, chronological. The window is the day bounds
 * (midnight to midnight), so off-hours events stay in the list and clamp
 * to the track edge at render instead of vanishing. */
function placedOn(events: DayEvent[], window: DayWindow): PlacedEvent[] {
  return events
    .map((event) => ({ ...event, startMs: Date.parse(event.start), endMs: Date.parse(event.end) }))
    .filter((event) => !Number.isNaN(event.startMs) && !Number.isNaN(event.endMs))
    .sort((a, b) => a.startMs - b.startMs)
    .filter((event) => event.endMs > window.start && event.startMs < window.end)
}

/* Fraction (0..1) of an ms timestamp across a window, clamped to the track
 * edge so off-hours events sit at the rail instead of off-track. */
export function fractionInWindow(ms: number, window: DayWindow): number {
  return Math.min(1, Math.max(0, (ms - window.start) / (window.end - window.start)))
}

/* Pill label: Figma-short local time, no meridiem (`9:30`). */
function formatPillTime(ms: number): string {
  const date = new Date(ms)
  const hour = date.getHours() % 12 || 12
  return `${hour}:${String(date.getMinutes()).padStart(2, '0')}`
}

/* Unambiguous time for the tooltip (`9:30 AM`). */
function formatFullTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/* Short weekday for the tooltip and lane labels (`Tue`). */
function formatWeekday(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short' })
}

function eventTitle(event: PlacedEvent): string {
  return `${event.title} · ${formatWeekday(event.startMs)} ${formatFullTime(event.startMs)}`
}

/* One Path track: progress fill, glowing dots at event positions, pills
 * alternating above/below in chronological order with a per-index accent.
 * Past events render muted. */
function DayTrack({
  placed,
  window,
  now,
  fillFraction,
  showNow,
  mutedFill
}: {
  placed: PlacedEvent[]
  window: DayWindow
  now: number
  fillFraction: number
  showNow: boolean
  mutedFill: boolean
}): React.JSX.Element {
  return (
    <div className="moki-day-path-track">
      <div className="moki-day-path-base" />
      <div
        className={`moki-day-path-fill${mutedFill ? ' is-muted' : ''}`}
        style={{ width: `${fillFraction * 100}%` }}
      />
      {placed.map((event, index) => {
        const left = fractionInWindow(event.startMs, window) * 100
        const above = index % 2 === 0
        const past = mutedFill || event.endMs <= now
        const accent = PATH_ACCENTS[index % PATH_ACCENTS.length]
        return (
          <div
            key={event.id}
            className="moki-day-path-event"
            style={{ left: `${left}%` }}
            data-accent={accent}
            data-testid={`timeline-event-${event.id}`}
            title={eventTitle(event)}
          >
            <span className={`moki-day-path-dot${past ? ' is-past' : ''}`} />
            <span className={`moki-day-path-stem${above ? ' is-above' : ''}${past ? ' is-past' : ''}`} />
            <span className={`moki-day-path-pill${above ? ' is-above' : ''}${past ? ' is-past' : ''}`}>
              <Text variant="control" className="moki-day-path-pill-name">
                {event.title}
              </Text>
              <Text variant="small" className="moki-day-path-pill-time">
                {formatPillTime(event.startMs)}
              </Text>
            </span>
          </div>
        )
      })}
      {showNow && (
        <div className="moki-day-path-now" style={{ left: `${fillFraction * 100}%` }} data-testid="timeline-now" />
      )}
    </div>
  )
}

/* Path card: glass timeline with a progress fill to now, glowing dots at
 * event positions, and pills alternating above/below the track in
 * chronological order with a per-event accent. Week mode renders seven
 * day-lanes, each reusing the single-day layout: the today lane keeps the
 * progress fill + now marker, past lanes render a full muted fill, future
 * lanes an empty track. */
export function DayTimeline({
  events,
  now,
  viewStart,
  spanDays,
  emptyLabel
}: {
  events: DayEvent[]
  now: number
  viewStart: Date
  spanDays: number
  emptyLabel: string
}): React.JSX.Element {
  const weekDays = useMemo(() => {
    if (spanDays <= 1) return null
    return Array.from(
      { length: spanDays },
      (_, offset) => new Date(viewStart.getFullYear(), viewStart.getMonth(), viewStart.getDate() + offset)
    )
  }, [spanDays, viewStart])
  const window = useMemo(() => singleDayWindow(viewStart), [viewStart])
  const bounds = useMemo(() => rangeBounds(viewStart, spanDays), [viewStart, spanDays])
  const placed = useMemo(() => placedOn(events, bounds), [events, bounds])
  const fillFraction = fractionInWindow(now, window)

  if (weekDays !== null) {
    const todayStart = new Date(now).setHours(0, 0, 0, 0)
    return (
      <section className="moki-day-path" aria-label="Week timeline" data-testid="day-timeline">
        {placed.length === 0 ? (
          <Text variant="control" tone="faint" className="moki-day-path-empty">
            {emptyLabel}
          </Text>
        ) : (
          <div className="moki-day-week">
            {weekDays.map((day) => {
              const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
              const laneWindow = singleDayWindow(day)
              const laneBounds = rangeBounds(day, 1)
              const lanePlaced = placedOn(events, laneBounds)
              const isPast = dayStart < todayStart
              const isToday = dayStart === todayStart
              const laneFill = isPast ? 1 : isToday ? fractionInWindow(now, laneWindow) : 0
              return (
                <div className="moki-day-lane" key={dayStart}>
                  <Text variant="control" tone="faint" className="moki-day-lane-label">
                    {formatWeekday(dayStart)} {day.getDate()}
                  </Text>
                  {lanePlaced.length === 0 ? (
                    <Text variant="control" tone="faint" className="moki-day-lane-empty">
                      No events
                    </Text>
                  ) : (
                    <DayTrack
                      placed={lanePlaced}
                      window={laneWindow}
                      now={now}
                      fillFraction={laneFill}
                      showNow={isToday && laneFill > 0 && laneFill < 1}
                      mutedFill={isPast}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="moki-day-path" aria-label="Day timeline" data-testid="day-timeline">
      {events.length === 0 ? (
        <Text variant="control" tone="faint" className="moki-day-path-empty">
          {emptyLabel}
        </Text>
      ) : (
        <DayTrack
          placed={placed}
          window={window}
          now={now}
          fillFraction={fillFraction}
          showNow={fillFraction > 0 && fillFraction < 1}
          mutedFill={false}
        />
      )}
    </section>
  )
}
