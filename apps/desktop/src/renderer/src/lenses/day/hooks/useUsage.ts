import { useEffect, useState } from 'react'
import type { DayUsageResult } from '../../../../../../../../packages/protocol/src/index'
import { callDay } from '../../../rpc/bridge'

const RETICK_MS = 30_000

/* Quota snapshot over `day:call`. The 30s re-tick bumps `now` alongside the
 * reload so the countdown text visibly refreshes even when the snapshot is
 * served from the main-process cache. Null while loading / without a bridge
 * — the widget keeps its sample-data fallback until live data arrives. */
export function useUsage(): { snapshot: DayUsageResult | null; now: number } {
  const [snapshot, setSnapshot] = useState<DayUsageResult | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const res = await callDay('day.usageGet')
        if (!cancelled) setSnapshot(res)
      } catch {
        /* Bridge missing — fallback rows stay. */
      }
    }
    void load()
    const timer = window.setInterval(() => {
      setNow(Date.now())
      void load()
    }, RETICK_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return { snapshot, now }
}

/* Countdown text for a reset ISO string: "3h 12m", "2d 4h", "19d 2h", or
 * "--" when unknown/unparsable. Pure for tests. */
export function formatResetText(resetsAt: string | null | undefined, nowMs = Date.now()): string {
  if (!resetsAt) return '--'
  const target = Date.parse(resetsAt)
  if (Number.isNaN(target)) return '--'
  const diffMs = target - nowMs
  if (diffMs <= 0) return 'now'
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}
