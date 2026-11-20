import { useEffect, useState } from 'react'
import type { DayClipboardEntry } from '../../../../../../../../packages/protocol/src/index'
import { callDay, onBridge } from '../../../rpc/bridge'

/* Mirrors the main-process caps: pushes stay newest-first at 100 and single
 * entries truncate at 2000 chars with their full length attached. */
const LIVE_CAP = 100
const LIVE_TEXT_MAX = 2000

function truncateLiveText(text: string): string {
  if (text.length <= LIVE_TEXT_MAX) return text
  return `${text.slice(0, LIVE_TEXT_MAX)}… (${text.length} chars)`
}

function sanitizeLive(entries: DayClipboardEntry[]): DayClipboardEntry[] {
  const seen = new Set<string>()
  const out: DayClipboardEntry[] = []
  for (const entry of entries) {
    if (!entry || typeof entry.text !== 'string' || entry.text === '') continue
    const text = truncateLiveText(entry.text)
    if (seen.has(text)) continue
    seen.add(text)
    out.push({ ...entry, text })
  }
  return out.slice(0, LIVE_CAP)
}

/* Live clipboard: initial list over `day:call`, then prepend on
 * `day.clipboardChanged` pushes (deduped by text, newest first, capped at
 * 100). Falls back to [] when the bridge is missing — the widget merges
 * with local pins. */
export function useDayClipboard(): { entries: DayClipboardEntry[]; clear: () => Promise<void> } {
  const [entries, setEntries] = useState<DayClipboardEntry[]>([])

  useEffect(() => {
    let cancelled = false
    callDay('day.clipboardList')
      .then((res) => {
        if (cancelled) return
        setEntries(sanitizeLive(Array.isArray(res.entries) ? res.entries : []))
      })
      .catch(() => {
        /* No bridge — live list stays empty, local entries still render. */
      })
    const off = onBridge('day.clipboardChanged', (payload) => {
      if (cancelled) return
      const entry = (payload as { entry?: DayClipboardEntry }).entry
      if (!entry || typeof entry.text !== 'string' || entry.text === '') return
      const safe: DayClipboardEntry = { ...entry, text: truncateLiveText(entry.text) }
      setEntries((prev) => {
        if (prev.some((e) => e.text === safe.text)) return prev
        return [safe, ...prev].slice(0, LIVE_CAP)
      })
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  async function clear(): Promise<void> {
    try {
      await callDay('day.clipboardClear')
    } catch {
      /* Clearing live state is best-effort without a bridge. */
    }
    setEntries([])
  }

  return { entries, clear }
}
