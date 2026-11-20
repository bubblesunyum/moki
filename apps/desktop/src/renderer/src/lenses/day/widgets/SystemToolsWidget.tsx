import { useEffect, useRef, useState } from 'react'
import { Icon, QuietState, Text, type FigmaIconName } from '../../../ui'
import { toSystemRows, useSystemStats } from '../hooks/useSystemStats'

/* System rows fed by the sampler bridge + a local action grid. Without live
 * data the static sample shape stays with its quiet line; live rows replace
 * it (unknown fields render "--", never invented numbers). GPU has no JS
 * source, so it stays "--" even when live. */
const STATS = [
  { label: 'CPU', pct: 34, detail: '4.2 GHz · 8 cores · 34% busy', tone: 'is-cpu' },
  { label: 'GPU', pct: 21, detail: 'Metal · 21% busy · 38°', tone: 'is-gpu' },
  { label: 'Memory', pct: 58, detail: '9.3 / 16 GB · mild pressure', tone: 'is-memory' },
  { label: 'Battery', pct: 82, detail: '82% · discharging · ~6h left', tone: 'is-battery' }
] as const

const TOOLS: { name: string; icon: FigmaIconName; subtitle: string }[] = [
  { name: 'Copy Text', icon: 'copy', subtitle: 'Clipboard' },
  { name: 'Focus 25-min', icon: 'timer', subtitle: 'Timer' },
  { name: 'Mute', icon: 'volume-x', subtitle: 'System' },
  { name: 'Screenshot', icon: 'camera', subtitle: 'PNG' }
]

export function SystemToolsWidget(): React.JSX.Element {
  const [noticeTool, setNoticeTool] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const { stats } = useSystemStats()

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  function runTool(tool: string): void {
    setNoticeTool(tool)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNoticeTool(null), 1600)
  }

  /* Uncontrolled <details>: the browser owns open state, rows render their
   * detail always (hidden until opened). Sample shapes feed the same rows. */
  const rows = stats
    ? toSystemRows(stats)
    : STATS.map((r) => ({ ...r, pct: r.pct as number | null }))

  return (
    <div className="moki-sys" data-testid="system-tools-widget">
      <div className="moki-sys-rows">
        {rows.map((row) => (
          <details key={row.label} className={['moki-sys-row', row.tone].join(' ')}>
            <summary className="moki-sys-head">
              <Icon name="chevron-right" size={12} />
              <Text variant="text" as="span" className="moki-sys-title">
                {row.label}
              </Text>
              <div
                className="moki-sys-bar"
                role="progressbar"
                aria-label={stats ? `${row.label} ${row.pct === null ? 'unknown' : `${row.pct}%`}` : `Sample ${row.label} ${row.pct}%`}
                aria-valuenow={row.pct ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="moki-sys-fill" style={{ width: `${row.pct ?? 0}%` }} />
              </div>
              <Text variant="small" as="span" className="moki-sys-value">
                {row.pct === null ? '--' : `${row.pct}%`}
              </Text>
            </summary>
            <div className="moki-sys-detail">
              {!stats && (
                <div className="moki-sys-spark" aria-hidden="true">
                  <Text variant="small" tone="faint" as="span">
                    Measuring…
                  </Text>
                </div>
              )}
              <Text variant="small" tone="faint">
                {row.detail}
              </Text>
              {stats && stats.breakdown.length > 0 && (
                <ul className="moki-sys-breakdown" aria-label={`${row.label} top processes`}>
                  {stats.breakdown.slice(0, 5).map((p) => (
                    <li key={`${row.label}-${p.pid}`}>
                      <Text variant="small" tone="faint" as="span">
                        {p.name} · {p.cpu}%
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ))}
      </div>
      {!stats && (
        <QuietState icon="infinity" text="Sample data — live stats coming" label="System stats offline" />
      )}
      <div className="moki-sys-tools" role="group" aria-label="Tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.name}
            type="button"
            className="moki-sys-tool"
            aria-label={tool.name}
            onClick={() => runTool(tool.name)}
          >
            <span className="moki-sys-tile" aria-hidden="true">
              <Icon name={tool.icon} size={16} />
            </span>
            <Text variant="small" as="span" className="moki-sys-toolname">
              {tool.name}
            </Text>
            <Text variant="small" tone="faint" as="span" className="moki-sys-toolsub">
              {tool.subtitle}
            </Text>
          </button>
        ))}
      </div>
      {noticeTool !== null && (
        <Text variant="small" tone="faint" role="status" aria-label="Tool notice">
          {noticeTool}
        </Text>
      )}
    </div>
  )
}
