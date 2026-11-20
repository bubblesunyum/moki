import type { DayClipboardEntry } from '../../../../../packages/protocol/src/index'

export const CLIPBOARD_CAP = 100
export const CLIPBOARD_POLL_MS = 1000
/** Single-entry ceiling: over-long pastes truncate with their full length. */
export const CLIPBOARD_TEXT_MAX = 2000

/* Text-only v1: images/RTF on the clipboard are skipped. A follow-up can
 * extend the watcher with `clipboard.readImage()` + thumbnail rows. */

/** Newest-first, deduped by exact text (first occurrence wins). */
export function dedupeClipboard(entries: DayClipboardEntry[]): DayClipboardEntry[] {
  const seen = new Set<string>()
  const out: DayClipboardEntry[] = []
  for (const entry of entries) {
    if (typeof entry?.text !== 'string' || entry.text === '') continue
    if (seen.has(entry.text)) continue
    seen.add(entry.text)
    out.push(entry)
  }
  return out
}

export function capClipboard(entries: DayClipboardEntry[], limit = CLIPBOARD_CAP): DayClipboardEntry[] {
  return entries.slice(0, Math.max(0, limit))
}

export function makeClipboardEntry(text: string, nowMs: number): DayClipboardEntry {
  return { id: `${nowMs}-${Math.floor(Math.random() * 1e6)}`, text, copiedAt: nowMs }
}

export function truncateClipboardText(text: string, limit = CLIPBOARD_TEXT_MAX): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}… (${text.length} chars)`
}

export interface ClipboardWatcherDeps {
  readText: () => string
  load: () => DayClipboardEntry[]
  save: (entries: DayClipboardEntry[]) => void
  onNew: (entry: DayClipboardEntry) => void
  now?: () => number
}

/* Polls the OS clipboard; on new non-empty text (skipping repeats) it
 * prepends, dedupes, caps at 100, persists, and notifies the renderer. */
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null
  private lastSeen = ''
  private entries: DayClipboardEntry[]

  constructor(private readonly deps: ClipboardWatcherDeps) {
    /* Stored rows predate the length cap — truncate on load so a stale
     * giant entry can't slip back into persist/broadcast/render. */
    this.entries = dedupeClipboard(
      capClipboard(deps.load().map((e) => ({ ...e, text: truncateClipboardText(e.text) })))
    )
  }

  list(): DayClipboardEntry[] {
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
    /* Seed the repeat guard from the live clipboard so Clear sticks: the
     * text still sitting on the OS clipboard must not resurrect as new. */
    let current = ''
    try {
      current = this.deps.readText() ?? ''
    } catch {
      current = ''
    }
    this.lastSeen = truncateClipboardText(current.trim())
    this.deps.save([])
  }

  /** Single poll step (also called by the 1s interval). */
  poll(): DayClipboardEntry | null {
    let raw = ''
    try {
      raw = this.deps.readText() ?? ''
    } catch {
      return null
    }
    const text = truncateClipboardText(raw.trim())
    if (text === '' || text === this.lastSeen) return null
    this.lastSeen = text
    if (this.entries[0]?.text === text) return null
    const entry = makeClipboardEntry(text, (this.deps.now ?? Date.now)())
    this.entries = capClipboard(dedupeClipboard([entry, ...this.entries]))
    try {
      this.deps.save(this.entries)
    } catch {
      /* Persist failures stay in memory — the widget still works. */
    }
    this.deps.onNew(entry)
    return entry
  }

  start(intervalMs = CLIPBOARD_POLL_MS): void {
    this.stop()
    this.timer = setInterval(() => this.poll(), intervalMs)
    if (typeof (this.timer as unknown as { unref?: () => void }).unref === 'function') {
      ;(this.timer as unknown as { unref: () => void }).unref()
    }
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }
}
