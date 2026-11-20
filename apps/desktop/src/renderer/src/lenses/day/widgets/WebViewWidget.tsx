import { createElement, useEffect, useRef, useState, type FormEvent } from 'react'
import { getBridge } from '../../../rpc/bridge'
import { IconButton, Text } from '../../../ui'
import { usePersistentState } from '../hooks/usePersistentState'

export const WEBVIEW_STORAGE_KEY = 'moki.day.webview.home'
export const WEBVIEW_HOME_DEFAULT = 'https://example.com'
export const WEBVIEW_PARTITION = 'persist:moki-websites'
const WEBVIEW_PREFS = 'contextIsolation=yes, sandbox=yes'

/* https-only allowlist: explicit http(s) URLs pass through as typed, bare
 * hosts gain an https:// scheme, everything else is rejected and nothing
 * loads (no javascript:, data:, file:, ftp:, or scheme-relative games). */
export function normalizeAddress(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '' || /\s/.test(trimmed)) return null
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(trimmed)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') return null
    try {
      const url = new URL(trimmed)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
      if (url.hostname === '') return null
      if (url.username !== '' || url.password !== '') return null
      return trimmed
    } catch {
      return null
    }
  }
  if (trimmed.startsWith('/') || trimmed.includes('\\')) return null
  try {
    const url = new URL(`https://${trimmed}`)
    if (url.hostname === '' || url.username !== '' || url.password !== '') return null
    return `https://${trimmed}`
  } catch {
    return null
  }
}

function validateHome(raw: unknown): string | null {
  return typeof raw === 'string' ? normalizeAddress(raw) : null
}

export function loadHome(): string {
  try {
    const raw = window.localStorage.getItem(WEBVIEW_STORAGE_KEY)
    if (typeof raw !== 'string') return WEBVIEW_HOME_DEFAULT
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
    return validateHome(parsed) ?? WEBVIEW_HOME_DEFAULT
  } catch {
    /* Storage blocked — fall back to the default home. */
    return WEBVIEW_HOME_DEFAULT
  }
}

/* Minimal webview surface: jsdom has no <webview>, so every method is
 * optional and every call is guarded — the address UI still works there. */
interface WebviewElement extends HTMLElement {
  goBack?(): void
  goForward?(): void
  reload?(): void
}

/* Web widget: a sandboxed <webview> under a floating pill (Back / Forward /
 * Reload / address field / Open in browser). The home URL persists per
 * widget in localStorage; in-page navigation follows it along. */
export function WebViewWidget(): React.JSX.Element {
  const [home, setHome] = usePersistentState<string>(
    WEBVIEW_STORAGE_KEY,
    validateHome,
    WEBVIEW_HOME_DEFAULT
  )
  const [draft, setDraft] = useState<string>(home)
  const [rejected, setRejected] = useState(false)
  const viewRef = useRef<WebviewElement | null>(null)

  /* Partition + sandbox land as plain attributes via this one path (props
   * only carry src — passing both would double-set the custom element). */
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    try {
      el.setAttribute('partition', WEBVIEW_PARTITION)
      el.setAttribute('sandbox', '')
      el.setAttribute('webpreferences', WEBVIEW_PREFS)
    } catch {
      /* Attribute writes never fail in practice — stay quiet. */
    }
  }, [])

  /* In-page link clicks follow the persisted home; popups open outside. */
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const onNavigate = (e: Event): void => {
      const url = (e as Event & { url?: unknown }).url
      if (typeof url !== 'string' || normalizeAddress(url) === null) return
      setHome(url)
      setDraft(url)
    }
    const onNewWindow = (e: Event): void => {
      e.preventDefault()
      const url = (e as Event & { url?: unknown }).url
      if (typeof url !== 'string') return
      getBridge()?.openExternal(url).catch(() => undefined)
    }
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('new-window', onNewWindow)
    return () => {
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('new-window', onNewWindow)
    }
  }, [setHome])

  function go(where: 'back' | 'forward' | 'reload'): void {
    try {
      if (where === 'back') viewRef.current?.goBack?.()
      else if (where === 'forward') viewRef.current?.goForward?.()
      else viewRef.current?.reload?.()
    } catch {
      /* No webview under test — the address UI still works. */
    }
  }

  function openOutside(): void {
    getBridge()?.openExternal(home).catch(() => undefined)
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
        ref: (el: WebviewElement | null) => {
          viewRef.current = el
        },
        className: 'moki-day-webview-frame',
        'data-testid': 'day-webview-frame',
        src: home
      })}
    </div>
  )
}
