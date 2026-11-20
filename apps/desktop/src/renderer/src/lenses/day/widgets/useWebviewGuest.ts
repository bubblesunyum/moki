import { useCallback, useEffect, useRef } from 'react'
import { onBridge } from '../../../rpc/bridge'
import { normalizeAddress, WEBVIEW_PARTITION, WEBVIEW_PREFS } from './webviewShared'

/* Minimal webview surface: jsdom has no <webview>, so every method is
 * optional and every call is guarded. */
export interface WebviewGuestElement extends HTMLElement {
  goBack?(): void
  goForward?(): void
  reload?(): void
}

export interface WebviewGuestEvents {
  onNavigate(url: string): void
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

/* Shared sandboxed <webview> guest capability for the Day Web tile and its
 * Peek overlay: one place for the partition/sandbox/allowpopups attributes,
 * the allowlist validation, and the navigation listener wiring.
 *
 * Popups need `allowpopups` on the element or Chromium swallows them before
 * anything fires. The renderer-side `new-window` webview event was removed
 * in Electron 22, so popups are intercepted in main instead
 * (setupWebviewPopups): the native window is denied and the URL arrives
 * back here over `web.popup`, where the tile opens it as a Peek.
 *
 * Listeners attach through a stable callback ref, so a replaced guest node
 * never drops them; both `did-navigate` and `did-navigate-in-page` are
 * followed (subframe-only in-page events are ignored), and handlers receive
 * validated http(s) URLs only — unsafe schemes never reach the callers. */
export function useSandboxedWebview(events: WebviewGuestEvents): {
  setView: (el: WebviewGuestElement | null) => void
  go: (where: 'back' | 'forward' | 'reload') => void
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

  const setView = useCallback(
    (el: WebviewGuestElement | null) => {
      const prev = viewRef.current
      if (prev) {
        prev.removeEventListener('did-navigate', onNavigate)
        prev.removeEventListener('did-navigate-in-page', onInPage)
      }
      viewRef.current = el
      if (!el) return
      try {
        el.setAttribute('partition', WEBVIEW_PARTITION)
        el.setAttribute('sandbox', '')
        el.setAttribute('webpreferences', WEBVIEW_PREFS)
        /* Without this Chromium swallows window.open/target=_blank before
         * main ever sees the popup — sign-in buttons silently do nothing. */
        el.setAttribute('allowpopups', '')
      } catch {
        /* Attribute writes never fail in practice — stay quiet. */
      }
      el.addEventListener('did-navigate', onNavigate)
      el.addEventListener('did-navigate-in-page', onInPage)
    },
    [onNavigate, onInPage]
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

  return { setView, go }
}
