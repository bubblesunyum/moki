import { useEffect, useRef, useState } from 'react'
import { QuietState, Text } from '../../../ui'

/* Static snapshot rows + a local action grid. No bridge calls: each tool
 * button just raises a fading HUD notice line. */
const STATS = [
  { label: 'CPU', pct: 34, detail: '4.2 GHz · 8 cores · 34% busy' },
  { label: 'GPU', pct: 21, detail: 'Metal · 21% busy · 38°' },
  { label: 'Memory', pct: 58, detail: '9.3 / 16 GB · mild pressure' },
  { label: 'Battery', pct: 82, detail: '82% · discharging · ~6h left' }
] as const

const TOOLS = ['Copy Text', 'Focus 25-min', 'Mute', 'Screenshot'] as const

export function SystemToolsWidget(): React.JSX.Element {
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null)
  const [noticeTool, setNoticeTool] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

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

  return (
    <div className="moki-sys" data-testid="system-tools-widget">
      <div className="moki-sys-rows">
        {STATS.map((row) => (
          <details key={row.label} className="moki-sys-row" open={expandedLabel === row.label}>
            <summary
              className="moki-sys-head"
              onClick={(e) => {
                e.preventDefault()
                setExpandedLabel((prev) => (prev === row.label ? null : row.label))
              }}
            >
              <Text variant="small">{row.label}</Text>
              <div
                className="moki-sys-bar"
                role="progressbar"
                aria-label={`Sample ${row.label} ${row.pct}%`}
                aria-valuenow={row.pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="moki-sys-fill" style={{ width: `${row.pct}%` }} />
              </div>
              <Text variant="small" tone="faint">
                {row.pct}%
              </Text>
            </summary>
            {expandedLabel === row.label && (
              <Text variant="small" tone="faint">
                {row.detail}
              </Text>
            )}
          </details>
        ))}
      </div>
      <QuietState icon="infinity" text="Sample data — live stats coming" label="System stats offline" />
      <div className="moki-sys-tools" role="group" aria-label="Tools">
        {TOOLS.map((tool) => (
          <button key={tool} type="button" className="moki-sys-tool" onClick={() => runTool(tool)}>
            {tool}
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
