import { createElement, useState, type FormEvent } from 'react'
import { getBridge } from '../../../rpc/bridge'
import { IconButton, Text } from '../../../ui'
import { usePersistentState } from '../hooks/usePersistentState'
import { WebPeek } from './WebPeek'
import { useSandboxedWebview } from './useWebviewGuest'
import {
  normalizeAddress,
  validateWebviewHome,
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
 * home URL persists per widget, and in-page navigation follows it along. */
export function WebViewWidget(): React.JSX.Element {
  const [home, setHome] = usePersistentState<string>(
    WEBVIEW_STORAGE_KEY,
    validateWebviewHome,
    WEBVIEW_HOME_DEFAULT
  )
  const [draft, setDraft] = useState<string>(home)
  const [rejected, setRejected] = useState(false)
  const [peek, setPeek] = useState<string | null>(initialPeekUrl)

  /* Guest wiring (partition, sandbox, allowlist, listeners) lives in the
   * shared hook; the tile only says what navigation and popups mean. */
  const { setView, go } = useSandboxedWebview({
    onNavigate: (url) => {
      setHome(url)
      setDraft(url)
    },
    onNewWindow: (url) => {
      setPeek(url)
    }
  })

  function openOutside(): void {
    getBridge()?.openExternal(home).catch(() => undefined)
  }

  /* Expand: the peeked page becomes the tile — Arc's "open as tab". The
   * key remounts the peek per popup, so a second popup never inherits the
   * first one's title bar or Expand target. */
  function expandPeek(url: string): void {
    setHome(url)
    setDraft(url)
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
    setHome(next)
    setDraft(next)
  }

  return (
    <div className="moki-day-webview" data-testid="day-webview">
      <div className="moki-day-webview-pill" role="toolbar" aria-label="Web controls">
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
        src: home
      })}
      {peek !== null && <WebPeek key={peek} url={peek} onClose={() => setPeek(null)} onExpand={expandPeek} />}
    </div>
  )
}
