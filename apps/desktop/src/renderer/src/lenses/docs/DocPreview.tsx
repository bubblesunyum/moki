import { createElement, useEffect, useRef, useState } from 'react'
import { getBridge } from '../../rpc/bridge'
import { Icon, IconButton, QuietState, Text } from '../../ui'
import { WebPeek } from '../day/widgets/WebPeek'
import { useSandboxedWebview, useWebviewPopup } from '../day/widgets/useWebviewGuest'
import { hostOf, isSecureUrl, originOf, WEBVIEW_GUEST_ATTRS } from '../day/widgets/webviewShared'
import { isWarmHopOrigin } from './warmHop'
import type { DocItem } from '../../../../../../../packages/protocol/src/index'

/* Right-pane preview: the selected doc loads in the shared hardened guest
 * (same persist:moki-websites session as the Day tile and Peek, so a sign-in
 * started anywhere finishes logged in) under a small nav bar — Back /
 * Forward / Reload / host / Open in browser. The guest is keyed by app
 * origin, not by URL: a same-app pick keeps the live element for apps
 * verified to route in-page (WARM_HOP_ORIGINS) and hops without
 * reloading, while any other pick — cross-app or same-app — commits src
 * as a real load. Auth redirects inside the pane follow along and retitle
 * it; popups (OAuth windows, target=_blank) open as a Peek over the shell. */

export function DocPreview({ doc }: { doc: DocItem | null }): React.JSX.Element {
  const [peek, setPeek] = useState<string | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  /* Where the guest actually is: every validated navigation (full or
   * in-page) and every mount/commit adopts it, and picks never clear it —
   * unlike `current`, which the chrome wants blank during a load. The hop
   * effect compares picks against this, so reselecting the doc a warm hop
   * landed on hops back instead of stranding the overlay over the wrong
   * page (mok-tlq; the strand itself was mok-ic6's). */
  const liveUrlRef = useRef<string | null>(null)
  /* Load-state: the guest paints white until its page exists — the quiet
   * overlay covers that flash until the guest's first dom-ready. Same-app
   * picks hop in-page (no dom-ready fires), so the in-page navigation
   * event lifts the overlay there instead. A same-src reload reuses the
   * painted page, so the overlay stays down. */
  const [ready, setReady] = useState(false)
  const { setView, go, routeInPage } = useSandboxedWebview({
    onNavigate: (url) => {
      liveUrlRef.current = url
      setCurrent(url)
    },
    onReady: () => setReady(true),
    onInPage: () => setReady(true)
  })
  useWebviewPopup(setPeek)

  /* Expand target: promoting a peeked page loads it in this pane (the
   * guest's src commits on user intent only — never on guest navigations,
   * which would reload the page out from under itself). Cleared per doc so
   * a new pick never inherits the old page. */
  const [override, setOverride] = useState<string | null>(null)

  /* A new pick replaces the pane: drop any Expand override, retitle, and
   * raise the loading overlay for the incoming page. An open peek belongs
   * to the old pick, so it closes too — the pane is long-lived now, and
   * nothing else owns that reset. */
  const docId = doc?.id
  useEffect(() => {
    setOverride(null)
    setCurrent(null)
    setReady(false)
    setPeek(null)
  }, [docId])

  /* The URL the pane wants to show. Pre-return (doc may be null): the
   * commit/hop state below must sit above the empty-state return with the
   * other hooks. Past the return this always equals `loaded`. */
  const nextUrl: string | null = override ?? doc?.openUrl ?? null

  /* Committed src: frozen while the app origin is unchanged, so React
   * never re-loadURLs the live guest out from under itself. Adopted
   * during render on a cross-origin pick (a remount, one commit, no
   * double load); same-origin picks leave it untouched and hop below.
   * An empty pane clears it — the guest unmounts with the pane, so a
   * stale src must never pre-load the next pick's app. */
  const [committedSrc, setCommittedSrc] = useState<string | null>(null)
  if (nextUrl === null) {
    if (committedSrc !== null) setCommittedSrc(null)
  } else if (committedSrc === null || originOf(committedSrc) !== originOf(nextUrl)) {
    setCommittedSrc(nextUrl)
  }

  /* A remount means a blank guest: readiness resets with the mount, in
   * the same commit — a post-paint effect would lag a frame and flash
   * the blank page with the overlay down. Same-origin hops keep
   * readiness; the app stays painted and the pick effect covers them.
   * The mount adopts its src as the live URL too: until the guest's
   * first navigation event, that is where it is going. */
  const guestKey = committedSrc === null ? null : originOf(committedSrc)
  const [mountedKey, setMountedKey] = useState<string | null>(null)
  if (guestKey !== mountedKey) {
    setMountedKey(guestKey)
    liveUrlRef.current = committedSrc
    if (guestKey !== null) setReady(false)
  }

  /* Same-app warm switch for verified apps only (WARM_HOP_ORIGINS): the
   * frozen src stays put and the live guest hops in-page — a
   * history.pushState the site's running app routes itself (popstate is
   * the router contract; the pane's Reload is the honest escape hatch if
   * an app misroutes). The comparison is against the guest's live URL,
   * not the frozen src — a warm hop never rewrites the src, so the pick
   * that lands back on the live URL (a reselect) must still hop, and the
   * pick that equals it must not re-load the page out from under itself.
   * Any other same-origin pick (Drive file views, Docs editors, future
   * apps) commits src — a real load, because those pages never service
   * a synthetic popstate and a hop would strand the pane on the old doc.
   * The hop's own in-page navigation event lifts the overlay; a cold
   * commit waits for the new document's dom-ready. Injection failure
   * falls back to the cold src commit: correct, just not warm. Unsafe
   * URLs never reach either path — the hook rejects them — and
   * cross-origin picks adopt above, so this effect only ever sees
   * same-origin http(s) pairs. */
  useEffect(() => {
    if (nextUrl === null || committedSrc === null) return
    if (originOf(nextUrl) !== originOf(committedSrc)) return
    if (nextUrl === liveUrlRef.current) return
    if (!isWarmHopOrigin(nextUrl)) {
      liveUrlRef.current = nextUrl
      setCommittedSrc(nextUrl)
      return
    }
    let cancelled = false
    routeInPage(nextUrl).catch(() => {
      if (!cancelled) setCommittedSrc(nextUrl)
    })
    return () => {
      cancelled = true
    }
  }, [nextUrl, committedSrc, routeInPage])

  if (doc === null) {
    return (
      <div className="moki-docs-empty" data-testid="docs-preview-empty">
        <QuietState icon="notes" text="Select a doc to preview" label="No doc selected" />
      </div>
    )
  }

  const loaded = override ?? doc.openUrl
  const shown = current ?? loaded

  function openOutside(): void {
    getBridge()?.openExternal(shown).catch(() => undefined)
  }

  function expandPeek(url: string): void {
    /* The effect above owns the route by the same rules as a pick: a
     * verified-app expand hops the live guest, anything else commits or
     * remounts. Either way the overlay covers the swap — until the
     * in-page event for a hop, until the new page's first dom-ready for
     * a cold load. */
    setReady(false)
    setOverride(url)
    setCurrent(url)
    setPeek(null)
  }

  return (
    <div className="moki-docs-preview" data-testid="docs-preview">
      <div className="moki-docs-preview-bar" role="toolbar" aria-label="Preview navigation">
        <IconButton icon="chevron-left" label="Back" size="sm" iconSize={16} onClick={() => go('back')} />
        <IconButton
          icon="chevron-right"
          label="Forward"
          size="sm"
          iconSize={16}
          onClick={() => go('forward')}
        />
        <IconButton icon="rotate-cw" label="Reload" size="sm" iconSize={16} onClick={() => go('reload')} />
        <Text variant="small" as="p" className="moki-docs-preview-host" title={shown}>
          {isSecureUrl(shown) ? <Icon name="lock" size={12} aria-hidden /> : null} {hostOf(shown)}
        </Text>
        <IconButton
          icon="external-link"
          label="Open in browser"
          size="sm"
          iconSize={16}
          onClick={openOutside}
        />
      </div>
      <div className="moki-docs-preview-frame-wrap" key={originOf(committedSrc ?? loaded)}>
        {createElement('webview', {
          ref: setView,
          className: 'moki-docs-preview-frame',
          'data-testid': 'docs-preview-frame',
          src: committedSrc ?? loaded,
          ...WEBVIEW_GUEST_ATTRS
        })}
        {!ready && (
          <div
            className="moki-docs-preview-loading"
            data-testid="docs-preview-loading"
            role="status"
            aria-label="Loading preview"
          >
            <Text variant="small" tone="muted" as="p" className="moki-docs-preview-loading-text">
              Loading…
            </Text>
          </div>
        )}
      </div>
      {peek !== null && <WebPeek key={peek} url={peek} onClose={() => setPeek(null)} onExpand={expandPeek} />}
    </div>
  )
}
