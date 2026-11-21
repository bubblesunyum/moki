import { useCallback, useEffect, useRef } from 'react'
import { onBridge } from '../../../rpc/bridge'
import { normalizeAddress } from './webviewShared'

/* Minimal webview surface: jsdom has no <webview>, so every method is
 * optional and every call is guarded. */
export interface WebviewGuestElement extends HTMLElement {
  goBack?(): void
  goForward?(): void
  reload?(): void
  getWebContentsId?(): number
}

export interface WebviewGuestEvents {
  onNavigate(url: string): void
  /* Load-state signal: the guest's `dom-ready` fired and first paint is
   * imminent. Optional so existing consumers (Day tile, Peek) keep their
   * behavior untouched. */
  onReady?(): void
}

/* Popup route, renderer half. Main denies the native window and forwards
 * the URL over `web.popup`; this validates it again (strict allowlist) and
 * hands clean URLs to the tile. The params-shape guard is load-bearing: the
 * `rpc:notify` channel multiplexes a second sender (the helper fan-out), so
 * a param-less notification must be ignored, never destructured. */
export function useWebviewPopup(onPopup: (url: string) => void): void {
  const onPopupRef = useRef(onPopup)
  useEffect(() => {
    onPopupRef.current = onPopup
  })
  useEffect(
    () =>
      onBridge('web.popup', (params: unknown) => {
        const url = (params as { url?: unknown } | null | undefined)?.url
        if (typeof url !== 'string' || normalizeAddress(url) === null) return
        onPopupRef.current(url)
      }),
    []
  )
}

/* Guest right-click route: main forwards the guest's `context-menu` as a
 * signal carrying its webContentsId. The tile toggles its toolbar only
 * for its own guest's signals — its Peek's guest is a different id and is
 * ignored. Unknown or id-less signals never toggle. */
export function useWebviewContextMenu(onToggle: () => void, isOwnGuest: (id: unknown) => boolean): void {
  const onToggleRef = useRef(onToggle)
  const isOwnGuestRef = useRef(isOwnGuest)
  useEffect(() => {
    onToggleRef.current = onToggle
    isOwnGuestRef.current = isOwnGuest
  })
  useEffect(
    () =>
      onBridge('web.contextMenu', (params: unknown) => {
        const guestId = (params as { guestId?: unknown } | null | undefined)?.guestId
        if (!isOwnGuestRef.current(guestId)) return
        onToggleRef.current()
      }),
    []
  )
}

/* Shared sandboxed <webview> guest capability for the Day Web tile and its
 * Peek overlay: one place for the allowlist validation and the navigation
 * listener wiring. The guest attributes live in WEBVIEW_GUEST_ATTRS
 * (webviewShared) and are applied declaratively at both createElement
 * call sites, present before the guest is created.
 *
 * Popups need `allowpopups` on the element or Chromium swallows them before
 * anything fires. The renderer-side `new-window` webview event was removed
 * in Electron 22, so popups are intercepted in main instead
 * (setupWebviewPopups): the native window is denied and the URL arrives
 * back here over `web.popup`, where the tile opens it as a Peek.
 *
 * Listeners attach through a stable callback ref, so a replaced guest node
 * never drops them; both `did-navigate` and `did-navigate-in-page` are
 * followed (subframe-only in-page events are ignored), `dom-ready` feeds
 * the optional load-state event, and handlers receive validated http(s)
 * URLs only — unsafe schemes never reach the callers. */
export function useSandboxedWebview(events: WebviewGuestEvents): {
  setView: (el: WebviewGuestElement | null) => void
  go: (where: 'back' | 'forward' | 'reload') => void
  isOwnGuest: (id: unknown) => boolean
} {
  const viewRef = useRef<WebviewGuestElement | null>(null)
  const eventsRef = useRef(events)
  useEffect(() => {
    eventsRef.current = events
  })

  const onNavigate = useCallback((e: Event): void => {
    const url = (e as Event & { url?: unknown }).url
    if (typeof url !== 'string' || normalizeAddress(url) === null) return
    eventsRef.current.onNavigate(url)
  }, [])

  const onInPage = useCallback(
    (e: Event): void => {
      /* Electron also emits this for subframes — only the main frame
       * tracks where the page actually landed. */
      if ((e as Event & { isMainFrame?: unknown }).isMainFrame === false) return
      onNavigate(e)
    },
    [onNavigate]
  )

  /* First-paint signal: `dom-ready` means the guest's document exists, so
   * a loading overlay can lift. Optional, like the other events, so jsdom
   * (no guest) and consumers without it stay safe. */
  const onDomReady = useCallback((): void => {
    eventsRef.current.onReady?.()
  }, [])

  const setView = useCallback(
    (el: WebviewGuestElement | null) => {
      const prev = viewRef.current
      if (prev) {
        prev.removeEventListener('did-navigate', onNavigate)
        prev.removeEventListener('did-navigate-in-page', onInPage)
        prev.removeEventListener('dom-ready', onDomReady)
      }
      viewRef.current = el
      if (!el) return
      /* Attributes (partition/sandbox/webpreferences/allowpopups) are
       * declarative JSX props on the element, set before attach: the
       * popup permission in particular may only be read at guest
       * creation, so setting it here would be too late. */
      el.addEventListener('did-navigate', onNavigate)
      el.addEventListener('did-navigate-in-page', onInPage)
      el.addEventListener('dom-ready', onDomReady)
    },
    [onNavigate, onInPage, onDomReady]
  )

  const go = useCallback((where: 'back' | 'forward' | 'reload'): void => {
    try {
      if (where === 'back') viewRef.current?.goBack?.()
      else if (where === 'forward') viewRef.current?.goForward?.()
      else viewRef.current?.reload?.()
    } catch {
      /* No webview under test — the chrome still works. */
    }
  }, [])

  /* Whether a main-routed signal came from this hook's live guest.
   * Read lazily: the id exists only once the guest is attached, and the
   * node can be replaced under us. Unknown guests never match. */
  const isOwnGuest = useCallback((id: unknown): boolean => {
    try {
      const mine = viewRef.current?.getWebContentsId?.()
      return typeof mine === 'number' && mine === id
    } catch {
      return false
    }
  }, [])

  return { setView, go, isOwnGuest }
}
