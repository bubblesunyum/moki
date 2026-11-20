/* Day hero: no weather source exists, so the hero never invents one. */

import { Text } from '../../ui'

const RING_SIZE = 164
const RING_RADIUS = 70
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function dayFraction(now: number): number {
  const date = new Date(now)
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.min(1, Math.max(0, (now - start) / 86_400_000))
}

export function DayHeader({ now, title, sub }: { now: number; title: string; sub: string }): React.JSX.Element {
  const time = new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false })
  const fraction = dayFraction(now)
  /* Arc starts at the top and sweeps clockwise; the tip dot rides its end. */
  const angle = -Math.PI / 2 + fraction * 2 * Math.PI
  const tipX = RING_SIZE / 2 + RING_RADIUS * Math.cos(angle)
  const tipY = RING_SIZE / 2 + RING_RADIUS * Math.sin(angle)
  return (
    <header className="moki-day-hero" data-testid="day-hero">
      <div className="moki-day-ring" aria-hidden="true">
        <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
          <defs>
            <linearGradient id="moki-day-ring-arc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--moki-accent-cyan)' }} />
              <stop offset="1" style={{ stopColor: 'var(--moki-accent-violet)' }} />
            </linearGradient>
          </defs>
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={6}
            className="moki-day-ring-track"
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="url(#moki-day-ring-arc)"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${RING_CIRCUMFERENCE * fraction} ${RING_CIRCUMFERENCE}`}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
          <circle cx={tipX} cy={tipY} r={6} className="moki-day-ring-tip" />
        </svg>
        <Text variant="text" tone="ink" as="span" className="moki-day-ring-time">
          {time}
        </Text>
      </div>
      <div className="moki-day-hero-titles">
        <h1 className="moki-day-hero-weekday">{title}</h1>
        <p className="moki-day-hero-sub">{sub}</p>
      </div>
    </header>
  )
}
