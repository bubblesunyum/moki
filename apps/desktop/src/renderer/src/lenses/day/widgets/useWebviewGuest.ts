import { useCallback, useEffect, useRef } from 'react'
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
  onNewWindow(url: string): void
}

/* Shared sandboxed <webview> guest capability for the Day Web tile and its
 * Peek overlay: one place for the partition/sandbox attributes, the
 * allowlist validation, and the navigation/popup listener wiring.
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

  const onNewWindow = useCallback((e: Event): void => {
    e.preventDefault()
    const url = (e as Event & { url?: unknown }).url
    if (typeof url !== 'string' || normalizeAddress(url) === null) return
    eventsRef.current.onNewWindow(url)
  }, [])

  const setView = useCallback(
    (el: WebviewGuestElement | null) => {
      const prev = viewRef.current
      if (prev) {
        prev.removeEventListener('did-navigate', onNavigate)
        prev.removeEventListener('did-navigate-in-page', onInPage)
        prev.removeEventListener('new-window', onNewWindow)
      }
      viewRef.current = el
      if (!el) return
      try {
        el.setAttribute('partition', WEBVIEW_PARTITION)
        el.setAttribute('sandbox', '')
        el.setAttribute('webpreferences', WEBVIEW_PREFS)
      } catch {
        /* Attribute writes never fail in practice — stay quiet. */
      }
      el.addEventListener('did-navigate', onNavigate)
      el.addEventListener('did-navigate-in-page', onInPage)
      el.addEventListener('new-window', onNewWindow)
    },
    [onNavigate, onInPage, onNewWindow]
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
