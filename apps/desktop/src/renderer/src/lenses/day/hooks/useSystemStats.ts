import { useEffect, useState } from 'react'
import type { DaySystemResult } from '../../../../../../../../packages/protocol/src/index'
import { callDay } from '../../../rpc/bridge'

const POLL_MS = 4000

export interface SystemRow {
  label: string
  pct: number | null
  detail: string
  tone: 'is-cpu' | 'is-gpu' | 'is-memory' | 'is-battery'
}

function pctOrNull(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null
  return Math.round(Math.min(100, Math.max(0, n)))
}

/* Pure row mapping (tested via the formatters): unknown fields render "--",
 * never invented numbers. GPU has no JS source so it stays "--" even live. */
export function toSystemRows(stats: DaySystemResult): SystemRow[] {
  const memPct =
    stats.memoryTotalBytes > 0 ? (stats.memoryUsedBytes / stats.memoryTotalBytes) * 100 : null
  const cpu = pctOrNull(stats.cpuPercent)
  const mem = pctOrNull(memPct)
  return [
    {
      label: 'CPU',
      pct: cpu,
      detail: cpu === null ? 'Measuring…' : `${stats.cpuCores} cores · ${cpu}% busy`,
      tone: 'is-cpu'
    },
    {
      label: 'GPU',
      pct: null,
      detail: 'GPU not measured from JS',
      tone: 'is-gpu'
    },
    {
      label: 'Memory',
      pct: mem,
      detail: `${formatBytesGb(stats.memoryUsedBytes, stats.memoryTotalBytes)} · ${stats.memoryPressure} pressure`,
      tone: 'is-memory'
    },
    {
      label: 'Battery',
      pct: pctOrNull(stats.batteryPercent),
      detail: formatBatteryDetail(stats.batteryPercent, stats.batteryCharging, stats.batteryMinutesLeft),
      tone: 'is-battery'
    }
  ]
}

/* System sampler over `day:call`, polled every 4s while mounted (matches the
 * main-process ps/pmset throttle). Null until the first sample — the widget
 * keeps its quiet fallback and renders "--" for unknown fields. Overlapping
 * ticks are skipped and late arrivals ignored, so a slow sample never
 * overwrites a newer one. */
export function useSystemStats(): { stats: DaySystemResult | null } {
  const [stats, setStats] = useState<DaySystemResult | null>(null)

  useEffect(() => {
    let cancelled = false
    let inflight = false
    let generation = 0
    async function load(): Promise<void> {
      if (inflight) return
      inflight = true
      generation += 1
      const mine = generation
      try {
        const res = await callDay('day.systemGet')
        if (!cancelled && mine === generation) setStats(res)
      } catch {
        /* Bridge missing — fallback rows stay. */
      } finally {
        inflight = false
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return { stats }
}

/** "9.3 / 16.0 GB" from byte counts; "--" when the total is unknown. */
export function formatBytesGb(usedBytes: number, totalBytes: number): string {
  if (!Number.isFinite(usedBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) return '--'
  const gb = (n: number): string => `${(n / 1024 ** 3).toFixed(1)}`
  return `${gb(usedBytes)} / ${gb(totalBytes)} GB`
}

/** "~6h 12m left", "charging", or "--"/"No battery" handled by callers. */
export function formatBatteryDetail(
  percent: number | null,
  charging: boolean | null,
  minutesLeft: number | null
): string {
  if (percent === null) return 'No battery'
  const state = charging === true ? 'charging' : charging === false ? 'discharging' : 'battery'
  if (minutesLeft === null || !Number.isFinite(minutesLeft)) return `${percent}% · ${state}`
  const h = Math.floor(minutesLeft / 60)
  const m = minutesLeft % 60
  return `${percent}% · ${state} · ~${h}h ${m}m left`
}
