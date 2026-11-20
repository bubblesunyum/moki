import { createElement, useCallback, useState, type FormEvent } from 'react'
import { getBridge } from '../../../rpc/bridge'
import { IconButton, Text } from '../../../ui'
import { usePersistentState } from '../hooks/usePersistentState'
import { WebPeek } from './WebPeek'
import { useSandboxedWebview, useWebviewContextMenu, useWebviewPopup } from './useWebviewGuest'
import {
  normalizeAddress,
  validateWebviewHome,
  WEBVIEW_GUEST_ATTRS,
  WEBVIEW_HOME_DEFAULT,
  WEBVIEW_STORAGE_KEY
} from './webviewShared'

/* Capture override (dev only, via ?mokiPeek= on the startup URL): opens the
 * Peek on mount so screenshots can prove the overlay. Unknown or unsafe
 * values stay shut — an unvalidated peek must never load. */
export function initialPeekUrl(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('mokiPeek')
    if (raw === null || raw.trim() === '') return null
    return normalizeAddress(raw)
  } catch {
    return null
  }
}

/* Web widget: a sandboxed <webview> under a floating pill (Back / Forward /
 * Reload / address field / Open in browser). Popups and target=_blank links
 * open in an Arc-style Peek over the board instead of leaving the app; the
 * home URL persists per widget, and in-page navigation follows it along.
 *
 * The pill is hidden until toggled — the tile is a clean frame otherwise.
 * Right-click anywhere on the widget reveals it (guest right-clicks arrive
 * over `web.contextMenu`; tile-chrome ones toggle here, except inside the
 * pill, which keeps its native menus). A hover-reveal button in the tile
 * corner is the keyboard/screen-reader path, with aria-expanded.
 *
 * The guest's loaded URL commits on user intent only (submit, Expand).
 * Following guest navigations into `src` would make React rewrite it on
 * every redirect or param change and reload the page out from under
 * itself (stuck skeletons); did-navigate updates the draft and the
 * persisted home so a restart resumes position, without touching src. */
export function WebViewWidget(): React.JSX.Element {
  const [home, setHome] = usePersistentState<string>(
    WEBVIEW_STORAGE_KEY,
    validateWebviewHome,
    WEBVIEW_HOME_DEFAULT
  )
  const [committed, setCommitted] = useState<string>(home)
  const [draft, setDraft] = useState<string>(home)
  const [rejected, setRejected] = useState(false)
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [peek, setPeek] = useState<string | null>(initialPeekUrl)

  /* User-intended navigations commit all three: the loaded guest, the
   * persisted home, and the draft. Guest navigations deliberately skip
   * `committed` (see onNavigate) — one function so the three can't drift. */
  const commitUrl = useCallback(
    (url: string) => {
      setCommitted(url)
      setHome(url)
      setDraft(url)
    },
    [setHome]
  )
  const { setView, go, isOwnGuest } = useSandboxedWebview({
    onNavigate: (url) => {
      setHome(url)
      setDraft(url)
    }
  })

  /* Popup route: main denied the native window and forwarded the URL;
   * the hook re-validates before anything loads. */
  useWebviewPopup(setPeek)
  /* Toolbar toggle: guest right-clicks arrive over `web.contextMenu`
   * (guest input never reaches the DOM). Chrome-area right-clicks toggle
   * here too, except inside the pill itself — the address field keeps its
   * native cut/copy/paste menu. */
  const toggleToolbar = useCallback(() => setToolbarVisible((visible) => !visible), [])
  useWebviewContextMenu(toggleToolbar, isOwnGuest)

  /* Tile-chrome right-clicks toggle the pill. The pill itself opts out
   * (stopPropagation below) so its inputs keep their native menus. */
  const handleTileContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      toggleToolbar()
    },
    [toggleToolbar]
  )

  function openOutside(): void {
    getBridge()?.openExternal(home).catch(() => undefined)
  }

  /* Expand: the peeked page becomes the tile — Arc's "open as tab". The
   * key remounts the peek per popup, so a second popup never inherits the
   * first one's title bar or Expand target. */
  function expandPeek(url: string): void {
    commitUrl(url)
    setPeek(null)
  }

  function submit(e: FormEvent): void {
    e.preventDefault()
    const next = normalizeAddress(draft)
    if (next === null) {
      setRejected(true)
      return
    }
    setRejected(false)
    commitUrl(next)
  }

  return (
    <div
      className="moki-day-webview"
      data-testid="day-webview"
      onContextMenu={handleTileContextMenu}
    >
      <IconButton
        icon="ellipsis"
        label={toolbarVisible ? 'Hide web controls' : 'Show web controls'}
        aria-expanded={toolbarVisible}
        size="sm"
        iconSize={16}
        className="moki-day-webview-reveal"
        onClick={toggleToolbar}
      />
      {toolbarVisible && (
        <div
          className="moki-day-webview-pill"
          role="toolbar"
          aria-label="Web controls"
          onContextMenu={(e) => e.stopPropagation()}
        >
        <IconButton icon="chevron-left" label="Back" size="sm" iconSize={16} onClick={() => go('back')} />
        <IconButton
          icon="chevron-right"
          label="Forward"
          size="sm"
          iconSize={16}
          onClick={() => go('forward')}
        />
        <IconButton icon="rotate-cw" label="Reload" size="sm" iconSize={16} onClick={() => go('reload')} />
        <form className="moki-day-webview-address" onSubmit={submit}>
          <input
            aria-label="Web address"
            className="moki-day-webview-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
          />
        </form>
        <IconButton
          icon="external-link"
          label="Open in browser"
          size="sm"
          iconSize={16}
          onClick={openOutside}
        />
        </div>
      )}
      {rejected && (
        <Text variant="small" as="p" className="moki-day-webview-error" role="alert">
          Only http and https addresses load here
        </Text>
      )}
      {getBridge() === null && (
        <Text variant="small" as="p" className="moki-day-webview-note">
          Preview needs the desktop app
        </Text>
      )}
      {createElement('webview', {
        ref: setView,
        className: 'moki-day-webview-frame',
        'data-testid': 'day-webview-frame',
        /* Committed on user intent only (submit, Expand) — never on
         * guest navigations, which would reload the page under itself. */
        src: committed,
        ...WEBVIEW_GUEST_ATTRS
      })}
      {peek !== null && <WebPeek key={peek} url={peek} onClose={() => setPeek(null)} onExpand={expandPeek} />}
    </div>
  )
}
