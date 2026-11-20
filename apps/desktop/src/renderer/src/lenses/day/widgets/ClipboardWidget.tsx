import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IconButton, QuietState, Text } from '../../../ui'
import { usePersistentState } from '../hooks/usePersistentState'

export interface ClipboardEntry {
  id: string
  text: string
  isPinned: boolean
  copiedAt: number
}

export const CLIPBOARD_STORAGE_KEY = 'moki.day.clipboard'
const COPIED_MS = 1500

/* Malformed rows (missing id/text) are dropped so keys and handlers
 * can't collide on undefined ids. */
function validateEntries(raw: unknown): ClipboardEntry[] | null {
  if (typeof raw !== 'object' || raw === null) return null
  // Accepts the current bare-array shape and the legacy { entries } wrapper.
  const list = Array.isArray(raw) ? raw : (raw as { entries?: unknown }).entries
  if (!Array.isArray(list)) return null
  return list.filter(
    (e): e is ClipboardEntry =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as { id?: unknown }).id === 'string' &&
      (e as { id: string }).id !== '' &&
      typeof (e as { text?: unknown }).text === 'string'
  )
}

/* Clipboard scratch: pinned items up top, recent below. Copy-only v1 —
 * entries are copied back out; nothing is pasted into another app. */
export function ClipboardWidget(): React.JSX.Element {
  const [entries, setEntries] = usePersistentState<ClipboardEntry[]>(
    CLIPBOARD_STORAGE_KEY,
    validateEntries,
    []
  )
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copiedTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    },
    []
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => e.text.toLowerCase().includes(q))
  }, [entries, query])

  const pinned = filtered.filter((e) => e.isPinned)
  const recent = filtered.filter((e) => !e.isPinned)

  function togglePin(id: string): void {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, isPinned: !e.isPinned } : e)))
  }

  async function copyEntry(entry: ClipboardEntry): Promise<void> {
    try {
      await navigator.clipboard?.writeText(entry.text)
    } catch {
      /* jsdom and denied permissions have no clipboard — still confirm. */
    }
    setCopiedId(entry.id)
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), COPIED_MS)
  }

  /* Clear only what the filter shows — hidden recents survive. */
  function clearRecent(): void {
    const ids = new Set(recent.map((e) => e.id))
    setEntries((prev) => prev.filter((e) => e.isPinned || !ids.has(e.id)))
  }

  return (
    <div className="moki-clipboard" data-testid="clipboard-widget">
      <div className="moki-clipboard-search">
        {expanded ? (
          <input
            aria-label="Filter clipboard"
            className="moki-clipboard-input"
            placeholder="Filter…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => {
              if (query.trim() === '') setExpanded(false)
            }}
          />
        ) : (
          <IconButton
            icon="search"
            label="Search clipboard"
            size="sm"
            iconSize={16}
            onClick={() => setExpanded(true)}
          />
        )}
        {recent.length > 0 && (
          <button type="button" className="moki-clipboard-clear" onClick={clearRecent}>
            Clear
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <QuietState icon="notes" text="Clipboard is empty" label="Empty clipboard" />
      ) : filtered.length === 0 ? (
        <QuietState icon="search" text="No matches" label="No clipboard matches" />
      ) : (
        <>
          {pinned.length > 0 && (
            <section aria-label="Pinned">
              <Text variant="small" tone="faint">
                Pinned
              </Text>
              <ul className="moki-clipboard-list">
                {pinned.map((e) => (
                  <ClipboardRow
                    key={e.id}
                    entry={e}
                    copied={copiedId === e.id}
                    onPin={() => togglePin(e.id)}
                    onCopy={() => void copyEntry(e)}
                  />
                ))}
              </ul>
            </section>
          )}
          {recent.length > 0 && (
            <section aria-label="Recent">
              <Text variant="small" tone="faint">
                Recent
              </Text>
              <ul className="moki-clipboard-list">
                {recent.map((e) => (
                  <ClipboardRow
                    key={e.id}
                    entry={e}
                    copied={copiedId === e.id}
                    onPin={() => togglePin(e.id)}
                    onCopy={() => void copyEntry(e)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function ClipboardRow({
  entry,
  copied,
  onPin,
  onCopy
}: {
  entry: ClipboardEntry
  copied: boolean
  onPin: () => void
  onCopy: () => void
}): React.JSX.Element {
  return (
    <li className="moki-clipboard-row">
      <button
        type="button"
        className="moki-clipboard-text"
        title={entry.text}
        onClick={onCopy}
        aria-label={`Copy ${entry.text.slice(0, 40)}`}
      >
        <Text variant="text" as="span">
          {entry.text}
        </Text>
      </button>
      {copied && (
        <Text variant="small" tone="faint" role="status">
          Copied
        </Text>
      )}
      <button
        type="button"
        aria-label={entry.isPinned ? `Unpin ${entry.text.slice(0, 40)}` : `Pin ${entry.text.slice(0, 40)}`}
        aria-pressed={entry.isPinned}
        className="moki-clipboard-iconbtn"
        onClick={onPin}
      >
        <Icon name="star" size={16} fill={entry.isPinned ? 'currentColor' : 'none'} />
      </button>
    </li>
  )
}
