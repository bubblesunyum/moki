import { useState } from 'react'
import { Icon, IconButton, QuietState, Text } from '../../../ui'
import { getBridge } from '../../../rpc/bridge'
import { useDownloads } from '../hooks/useDownloads'
import { usePersistentState } from '../hooks/usePersistentState'
import { WidgetSection } from './WidgetSection'

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

/* Files shelf: live ~/Downloads rows above the local shelf (pinned,
 * expandable past six, plus recent). Drop files to add; tap an http(s)
 * entry to open it. Local-only v1 for the shelf — no ~/Downloads RPC. */
export function FilesWidget(): React.JSX.Element {
  const [entries, setEntries] = usePersistentState<FileEntry[]>(FILES_STORAGE_KEY, validateEntries, [])
  const [showHidden, setShowHidden] = useState(false)
  const [showAllPinned, setShowAllPinned] = useState(false)
  const [isOver, setIsOver] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  /* Live ~/Downloads above the local shelf (max 9, newest first). Empty
   * without a bridge — the shelf stays local-only. */
  const { entries: downloads, openPath, revealPath } = useDownloads(showHidden)

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
        <div className="moki-files-menu">
          <IconButton
            icon="ellipsis"
            label="Files actions"
            size="sm"
            iconSize={16}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          />
          {menuOpen && (
            <div
              className="moki-files-popover"
              role="menu"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setMenuOpen(false)
              }}
            >
              {recent.length > 0 && (
                <button type="button" className="moki-files-clear" onClick={clearRecent}>
                  <Text variant="small">Clear</Text>
                </button>
              )}
              <label className="moki-files-toggle">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
                <Text variant="small">Show hidden</Text>
                {showHidden && <Icon name="check" size={14} />}
              </label>
            </div>
          )}
        </div>
      </div>
      {visible.length === 0 && downloads.length === 0 ? (
        <QuietState icon="files" text="Drop files here" label="Empty files shelf" />
      ) : (
        <>
          {downloads.length > 0 && (
            <WidgetSection label="Downloads" title="Downloads">
              <ul className="moki-files-list">
                {downloads.map((d) => (
                  <li key={d.fullPath} className="moki-files-row">
                    <span className="moki-files-preview" aria-hidden="true">
                      <Icon name="files" size={20} />
                    </span>
                    <button
                      type="button"
                      className="moki-files-name"
                      title={d.fullPath}
                      aria-label={`Open ${d.name}`}
                      onClick={() => openPath(d.fullPath)}
                    >
                      <Text variant="text" as="span">
                        {d.name}
                      </Text>
                    </button>
                    <button
                      type="button"
                      aria-label={`Show ${d.name} in Finder`}
                      className="moki-files-iconbtn"
                      onClick={() => revealPath(d.fullPath)}
                    >
                      <Icon name="external-link" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </WidgetSection>
          )}
          {pinned.length > 0 && (
            <WidgetSection
              label="Pinned files"
              title="Pinned"
              header={
                pinned.length > PINNED_LIMIT ? (
                  <button
                    type="button"
                    className="moki-widget-section-label is-collapsible"
                    aria-label="Toggle pinned files"
                    aria-expanded={showAllPinned}
                    onClick={() => setShowAllPinned((v) => !v)}
                  >
                    <Text variant="small" tone="faint" as="span">
                      Pinned
                    </Text>
                    <Icon name="chevron-down" size={12} />
                  </button>
                ) : undefined
              }
            >
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
            </WidgetSection>
          )}
          {recent.length > 0 && (
            <WidgetSection label="Recent files" title="Recent">
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
            </WidgetSection>
          )}
        </>
      )}
    </div>
  )
}

function fileGlyph(name: string): 'globe' | 'files' | 'notes' {
  if (isHttpUrl(name)) return 'globe'
  if (name.endsWith('/')) return 'files'
  return 'notes'
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
      <span className="moki-files-preview" aria-hidden="true">
        <Icon name={fileGlyph(entry.name)} size={20} />
      </span>
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
        className={['moki-files-iconbtn', 'moki-files-pin', entry.isPinned ? 'is-pinned' : null]
          .filter(Boolean)
          .join(' ')}
        onClick={onPin}
      >
        <Icon name="star" size={14} fill={entry.isPinned ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        aria-label={`Remove ${entry.name}`}
        className="moki-files-iconbtn moki-files-remove"
        onClick={onRemove}
      >
        <Icon name="x" size={14} />
      </button>
    </li>
  )
}
