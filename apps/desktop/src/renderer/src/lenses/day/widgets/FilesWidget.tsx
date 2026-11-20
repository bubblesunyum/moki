import { useState } from 'react'
import { Icon, QuietState, Text } from '../../../ui'
import { getBridge } from '../../../rpc/bridge'
import { usePersistentState } from '../hooks/usePersistentState'

export interface FileEntry {
  id: string
  name: string
  isPinned: boolean
  addedAt: number
}

export const FILES_STORAGE_KEY = 'moki.day.files'
const PINNED_LIMIT = 6

/* Malformed rows (missing id/name) are dropped so keys and handlers
 * can't collide on undefined ids. */
function validateEntries(raw: unknown): FileEntry[] | null {
  if (typeof raw !== 'object' || raw === null) return null
  // Accepts the current bare-array shape and the legacy { entries } wrapper.
  const list = Array.isArray(raw) ? raw : (raw as { entries?: unknown }).entries
  if (!Array.isArray(list)) return null
  return list.filter(
    (e): e is FileEntry =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as { id?: unknown }).id === 'string' &&
      (e as { id: string }).id !== '' &&
      typeof (e as { name?: unknown }).name === 'string'
  )
}

function isHttpUrl(name: string): boolean {
  return /^https?:\/\//i.test(name)
}

/* Files shelf: pinned (expandable past 6) plus recent. Drop files to add;
 * tap an http(s) entry to open it. Local-only v1 — no ~/Downloads RPC. */
export function FilesWidget(): React.JSX.Element {
  const [entries, setEntries] = usePersistentState<FileEntry[]>(FILES_STORAGE_KEY, validateEntries, [])
  const [showHidden, setShowHidden] = useState(false)
  const [showAllPinned, setShowAllPinned] = useState(false)
  const [isOver, setIsOver] = useState(false)

  const visible = showHidden ? entries : entries.filter((e) => !e.name.startsWith('.'))
  const pinned = visible.filter((e) => e.isPinned)
  const recent = visible.filter((e) => !e.isPinned)
  const shownPinned = showAllPinned ? pinned : pinned.slice(0, PINNED_LIMIT)
  const extraPinned = pinned.length - shownPinned.length

  function addNames(names: string[]): void {
    if (names.length === 0) return
    setEntries((prev) => [
      ...names.map((name, i) => ({
        id: `${Date.now()}-${i}-${name}`,
        name,
        isPinned: false,
        addedAt: Date.now()
      })),
      ...prev
    ])
  }

  function togglePin(id: string): void {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, isPinned: !e.isPinned } : e)))
  }

  function removeEntry(id: string): void {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  /* Clear only visible recents — entries hidden by the dotfile filter
   * (or a future search) survive. */
  function clearRecent(): void {
    const ids = new Set(recent.map((e) => e.id))
    setEntries((prev) => prev.filter((e) => e.isPinned || !ids.has(e.id)))
  }

  function openEntry(entry: FileEntry): void {
    if (!isHttpUrl(entry.name)) return
    getBridge()?.openExternal(entry.name).catch(() => undefined)
  }

  return (
    <div
      className={['moki-files', isOver ? 'is-over' : ''].filter(Boolean).join(' ')}
      data-testid="files-widget"
      onDragOver={(e) => {
        e.preventDefault()
        setIsOver(true)
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsOver(false)
        const files = e.dataTransfer?.files
        if (!files) return
        addNames(Array.from(files).map((f) => f.name))
      }}
    >
      <div className="moki-files-tools">
        <label className="moki-files-toggle">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          <Text variant="small">Show hidden</Text>
        </label>
        {recent.length > 0 && (
          <button type="button" className="moki-files-clear" onClick={clearRecent}>
            Clear
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <QuietState icon="files" text="Drop files here" label="Empty files shelf" />
      ) : (
        <>
          {pinned.length > 0 && (
            <section aria-label="Pinned files">
              <Text variant="small" tone="faint">
                Pinned
              </Text>
              <ul className="moki-files-list">
                {shownPinned.map((e) => (
                  <FileRow
                    key={e.id}
                    entry={e}
                    onOpen={() => openEntry(e)}
                    onPin={() => togglePin(e.id)}
                    onRemove={() => removeEntry(e.id)}
                  />
                ))}
              </ul>
              {pinned.length > PINNED_LIMIT && (
                <button
                  type="button"
                  className="moki-files-more"
                  aria-expanded={showAllPinned}
                  aria-label={
                    showAllPinned
                      ? 'Show fewer pinned files'
                      : `Show ${extraPinned} more pinned files`
                  }
                  onClick={() => setShowAllPinned((v) => !v)}
                >
                  <Text variant="small" tone="faint">
                    {showAllPinned ? 'Show less' : `+${extraPinned} more`}
                  </Text>
                </button>
              )}
            </section>
          )}
          {recent.length > 0 && (
            <section aria-label="Recent files">
              <Text variant="small" tone="faint">
                Recent
              </Text>
              <ul className="moki-files-list">
                {recent.map((e) => (
                  <FileRow
                    key={e.id}
                    entry={e}
                    onOpen={() => openEntry(e)}
                    onPin={() => togglePin(e.id)}
                    onRemove={() => removeEntry(e.id)}
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

function FileRow({
  entry,
  onOpen,
  onPin,
  onRemove
}: {
  entry: FileEntry
  onOpen: () => void
  onPin: () => void
  onRemove: () => void
}): React.JSX.Element {
  const openable = isHttpUrl(entry.name)
  return (
    <li className="moki-files-row">
      {openable ? (
        <button
          type="button"
          className="moki-files-name"
          title={entry.name}
          aria-label={`Open ${entry.name}`}
          onClick={onOpen}
        >
          <Text variant="text" as="span">
            {entry.name}
          </Text>
        </button>
      ) : (
        <Text variant="text" as="span" className="moki-files-name" title={entry.name}>
          {entry.name}
        </Text>
      )}
      <button
        type="button"
        aria-label={entry.isPinned ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
        aria-pressed={entry.isPinned}
        className="moki-files-iconbtn"
        onClick={onPin}
      >
        <Icon name="star" size={16} fill={entry.isPinned ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        aria-label={`Remove ${entry.name}`}
        className="moki-files-iconbtn"
        onClick={onRemove}
      >
        <Icon name="x" size={16} />
      </button>
    </li>
  )
}
