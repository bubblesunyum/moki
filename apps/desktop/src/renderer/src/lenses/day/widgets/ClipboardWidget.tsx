import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IconButton, QuietState, Text } from '../../../ui'
import { useDayClipboard } from '../hooks/useDayClipboard'
import { usePersistentState } from '../hooks/usePersistentState'
import { WidgetSection } from './WidgetSection'

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
 * entries are copied back out; nothing is pasted into another app. Live OS
 * clipboard rows render above the local recents, deduped by exact text. */
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
  /* Live OS clipboard above the local scratch: read-only rows (copy works,
   * pin files a local pinned copy). Empty without a bridge — local stays. */
  const { entries: liveEntries, clear: clearLive } = useDayClipboard()

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    },
    []
  )

  const q = query.trim().toLowerCase()
  const matches = (text: string): boolean => q === '' || text.toLowerCase().includes(q)

  /* A live row whose text is already pinned locally is dropped (pins stay);
   * a local recent duplicating live text hides in favour of the live row. */
  const pinnedTexts = useMemo(
    () => new Set(entries.filter((e) => e.isPinned).map((e) => e.text)),
    [entries]
  )
  const liveFresh = useMemo(
    () => liveEntries.filter((e) => !pinnedTexts.has(e.text)),
    [liveEntries, pinnedTexts]
  )
  const liveTexts = useMemo(() => new Set(liveFresh.map((e) => e.text)), [liveFresh])
  const pinned = useMemo(
    () => entries.filter((e) => e.isPinned && matches(e.text)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, q]
  )
  const liveFiltered = useMemo(() => liveFresh.filter((e) => matches(e.text)), [liveFresh, q])
  const recentLocal = useMemo(
    () => entries.filter((e) => !e.isPinned && !liveTexts.has(e.text) && matches(e.text)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, liveTexts, q]
  )

  function pinLiveText(text: string): void {
    setEntries((prev) => {
      const existing = prev.find((e) => e.text === text)
      if (existing) {
        return prev.map((e) => (e.text === text ? { ...e, isPinned: true } : e))
      }
      return [{ id: `local-${Date.now()}-${text.slice(0, 16)}`, text, isPinned: true, copiedAt: Date.now() }, ...prev]
    })
  }

  function toggleLocalPin(id: string): void {
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

  /* Trash clears the visible recents plus any local recent hiding behind a
   * cleared live row (same text) — pins always survive. */
  function clearRecent(): void {
    const clearedTexts = new Set([...liveFiltered, ...recentLocal].map((e) => e.text))
    setEntries((prev) => prev.filter((e) => e.isPinned || !clearedTexts.has(e.text)))
    void clearLive()
  }

  function collapseSearch(): void {
    setQuery('')
    setExpanded(false)
  }

  const hasAny = entries.length > 0 || liveEntries.length > 0
  const hasRecent = liveFiltered.length > 0 || recentLocal.length > 0
  const lastLive = liveFiltered.length - 1

  return (
    <div className="moki-clipboard" data-testid="clipboard-widget">
      <div className="moki-clipboard-tools">
        {hasRecent && query.trim() === '' && (
          <IconButton
            icon="trash"
            label="Clear recent"
            size="sm"
            iconSize={16}
            onClick={clearRecent}
          />
        )}
        {expanded ? (
          <div className="moki-clipboard-searchfield">
            <Icon name="search" size={14} />
            <input
              aria-label="Filter clipboard"
              className="moki-clipboard-input"
              placeholder="Search"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') collapseSearch()
              }}
              onBlur={() => {
                if (query.trim() === '') setExpanded(false)
              }}
            />
            <button
              type="button"
              className="moki-clipboard-searchclose"
              aria-label={query === '' ? 'Close search' : 'Clear search'}
              onClick={() => {
                if (query === '') setExpanded(false)
                else setQuery('')
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ) : (
          <IconButton
            icon="search"
            label="Search clipboard"
            size="sm"
            iconSize={16}
            onClick={() => setExpanded(true)}
          />
        )}
      </div>
      {!hasAny ? (
        <QuietState icon="notes" text="No clipboard history yet" label="Empty clipboard" />
      ) : pinned.length === 0 && !hasRecent ? (
        <QuietState icon="search" text="No matches" label="No clipboard matches" />
      ) : (
        <>
          {pinned.length > 0 && (
            <WidgetSection label="Pinned" title="Pinned">
              <ul className="moki-clipboard-list">
                {pinned.map((e, i) => (
                  <ClipboardRow
                    key={e.id}
                    entry={e}
                    isLast={i === pinned.length - 1}
                    copied={copiedId === e.id}
                    onPin={() => toggleLocalPin(e.id)}
                    onCopy={() => void copyEntry(e)}
                  />
                ))}
              </ul>
            </WidgetSection>
          )}
          {hasRecent && (
            <WidgetSection label="Recent" title="Recent">
              <ul className="moki-clipboard-list">
                {liveFiltered.map((e, i) => (
                  <ClipboardRow
                    key={e.id}
                    entry={{ ...e, isPinned: false }}
                    isLast={i === lastLive && recentLocal.length === 0}
                    copied={copiedId === e.id}
                    onPin={() => pinLiveText(e.text)}
                    onCopy={() => void copyEntry({ ...e, isPinned: false })}
                  />
                ))}
                {recentLocal.map((e, i) => (
                  <ClipboardRow
                    key={e.id}
                    entry={e}
                    isLast={i === recentLocal.length - 1}
                    copied={copiedId === e.id}
                    onPin={() => toggleLocalPin(e.id)}
                    onCopy={() => void copyEntry(e)}
                  />
                ))}
              </ul>
            </WidgetSection>
          )}
        </>
      )}
    </div>
  )
}

function ClipboardRow({
  entry,
  isLast,
  copied,
  onPin,
  onCopy
}: {
  entry: ClipboardEntry
  isLast: boolean
  copied: boolean
  onPin: () => void
  onCopy: () => void
}): React.JSX.Element {
  return (
    <li className={['moki-clipboard-row', isLast ? 'is-last' : null].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="moki-clipboard-text"
        title={entry.text}
        onClick={onCopy}
        aria-label={`Copy ${entry.text.slice(0, 40)}`}
      >
        <Text variant="text" as="span" className="moki-clipboard-preview">
          {entry.text}
        </Text>
      </button>
      {copied && (
        <Text variant="small" tone="white" role="status" className="moki-clipboard-copied">
          Copied
        </Text>
      )}
      <button
        type="button"
        aria-label={entry.isPinned ? `Unpin ${entry.text.slice(0, 40)}` : `Pin ${entry.text.slice(0, 40)}`}
        aria-pressed={entry.isPinned}
        className={['moki-clipboard-iconbtn', entry.isPinned ? 'is-pinned' : null]
          .filter(Boolean)
          .join(' ')}
        onClick={onPin}
      >
        <Icon name="star" size={14} fill={entry.isPinned ? 'currentColor' : 'none'} />
      </button>
    </li>
  )
}
