import { QuietState, Text } from '../../../ui'

/* Static fixture snapshot until the quota bridge lands. Presentational only:
 * no props, no RPC — just the three quota rows and the sample-data note. */
const ROWS = [
  { label: '5-hour', used: 62, limit: 100, note: '62%' },
  { label: 'Weekly', used: 38, limit: 100, note: '38%' },
  { label: 'Monthly', used: 11, limit: 100, note: '11%' }
] as const

export function UsageWidget(): React.JSX.Element {
  return (
    <div className="moki-usage" data-testid="usage-widget">
      {ROWS.map((row) => (
        <div key={row.label} className="moki-usage-row">
          <Text variant="small">{row.label}</Text>
          <div
            className="moki-usage-bar"
            role="progressbar"
            aria-label={`Sample ${row.label} usage ${row.note}`}
            aria-valuenow={row.used}
            aria-valuemin={0}
            aria-valuemax={row.limit}
          >
            <div className="moki-usage-fill" style={{ width: `${row.used}%` }} />
          </div>
          <Text variant="small" tone="faint">
            {row.note}
          </Text>
        </div>
      ))}
      <QuietState icon="globe" text="Sample data — connect Go with /connect" label="Usage offline" />
    </div>
  )
}
