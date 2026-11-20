import { Icon, QuietState, Text } from '../../../ui'
import { getBridge } from '../../../rpc/bridge'
import { formatResetText, useUsage } from '../hooks/useUsage'

/* Quota rows: static sample shape until the usage bridge lands live data.
 * The "Sample data" line stays as the fallback and goes away only when a
 * live snapshot arrives — unreachable keeps showing samples, honestly. */
const ROWS = [
  { label: '5 hours', used: 62, pace: 0.55, reset: '3h 12m' },
  { label: 'Weekly', used: 38, pace: 0.43, reset: '2d 4h' },
  { label: 'Monthly', used: 11, pace: 0.36, reset: '19d 2h' }
] as const

const OPENCODE_URL = 'https://opencode.ai'

/* One quota row: label + reset countdown + percent over a 5px bar. Live and
 * sample rows share this — samples add the pace tick, live rows omit it. */
export function UsageWindowRow({
  label,
  reset,
  percent,
  pace,
  sample = false
}: {
  label: string
  reset: string
  /** Null renders "--" with an empty bar, never an invented number. */
  percent: number | null
  /** Sample-only pace marker (0–1 of the bar); live rows omit it. */
  pace?: number
  sample?: boolean
}): React.JSX.Element {
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent))
  const note = percent === null ? '--' : `${Math.round(percent)}%`
  return (
    <div className="moki-usage-window">
      <div className="moki-usage-row">
        <Text variant="text" as="span" className="moki-usage-title">
          {label}
        </Text>
        <span className="moki-usage-spacer" />
        <Text variant="small" tone="faint" as="span" className="moki-usage-reset">
          {reset}
        </Text>
        <Text variant="small" as="span" className="moki-usage-pct">
          {note}
        </Text>
      </div>
      <div
        className="moki-usage-bar"
        role="progressbar"
        aria-label={`${sample ? 'Sample ' : ''}${label} usage ${note}`}
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {pace !== undefined && <span className="moki-usage-pace" style={{ left: `${pace * 100}%` }} />}
        <div className="moki-usage-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

export function UsageWidget(): React.JSX.Element {
  const { snapshot, now } = useUsage()
  const live = snapshot?.status === 'live' ? snapshot : null

  function openUsage(): void {
    getBridge()?.openExternal(OPENCODE_URL).catch(() => undefined)
  }

  const windows = live
    ? [
        { label: '5 hours', window: live.rolling },
        { label: 'Weekly', window: live.weekly },
        { label: 'Monthly', window: live.monthly }
      ]
    : null

  return (
    <div className="moki-usage" data-testid="usage-widget">
      <div className="moki-usage-provider">
        <button type="button" className="moki-usage-provider-btn" onClick={openUsage} aria-label="Open usage in OpenCode">
          <Text variant="small" as="span" className="moki-usage-provider-name">
            OpenCode
          </Text>
          <Icon name="chevron-right" size={12} />
        </button>
      </div>
      {windows
        ? windows.map(({ label, window: w }) => (
            <UsageWindowRow
              key={label}
              label={label}
              reset={formatResetText(w?.resetsAt ?? null, now)}
              percent={typeof w?.percent === 'number' ? w.percent : null}
            />
          ))
        : ROWS.map((row) => (
            <UsageWindowRow
              key={row.label}
              label={row.label}
              reset={row.reset}
              percent={row.used}
              pace={row.pace}
              sample
            />
          ))}
      {!live && (
        <QuietState icon="globe" text="Sample data — connect Go with /connect" label="Usage offline" />
      )}
    </div>
  )
}
