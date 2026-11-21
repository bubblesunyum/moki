import { createElement, useEffect, useState } from 'react'
import { getBridge } from '../../rpc/bridge'
import { Icon, IconButton, QuietState, Text } from '../../ui'
import { WebPeek } from '../day/widgets/WebPeek'
import { useSandboxedWebview, useWebviewPopup } from '../day/widgets/useWebviewGuest'
import { hostOf, isSecureUrl, WEBVIEW_GUEST_ATTRS } from '../day/widgets/webviewShared'
import type { DocItem } from '../../../../../../../packages/protocol/src/index'

/* Right-pane preview: the selected doc loads in the shared hardened guest
 * (same persist:moki-websites session as the Day tile and Peek, so a sign-in
 * started anywhere finishes logged in) under a small nav bar — Back /
 * Forward / Reload / host / Open in browser. `key` on the open URL remounts
 * the guest per selection, so a new pick never inherits the old page's
 * redirects. Auth redirects inside the pane follow along and retitle it;
 * popups (OAuth windows, target=_blank) open as a Peek over the shell. */

export function DocPreview({ doc }: { doc: DocItem | null }): React.JSX.Element {
  const [peek, setPeek] = useState<string | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  /* Load-state: the guest hard-remounts per pick (key below, deliberate
   * isolation) and paints white until its page exists — the quiet overlay
   * covers that flash until the guest's first dom-ready. A same-src reload
   * reuses the painted page, so the overlay stays down. */
  const [ready, setReady] = useState(false)
  const { setView, go } = useSandboxedWebview({
    onNavigate: (url) => setCurrent(url),
    onReady: () => setReady(true)
  })
  useWebviewPopup(setPeek)

  /* Expand target: promoting a peeked page loads it in this pane (the
   * guest's src commits on user intent only — never on guest navigations,
   * which would reload the page out from under itself). Cleared per doc so
   * a new pick never inherits the old page. */
  const [override, setOverride] = useState<string | null>(null)

  /* A new pick replaces the pane: drop any Expand override, retitle, and
   * raise the loading overlay for the incoming page. */
  const docId = doc?.id
  useEffect(() => {
    setOverride(null)
    setCurrent(null)
    setReady(false)
  }, [docId])

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
    /* Same as a pick: the expanded URL remounts the guest (key below), so
     * raise the overlay until the new page's first dom-ready. */
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
      <div className="moki-docs-preview-frame-wrap" key={loaded}>
        {createElement('webview', {
          ref: setView,
          className: 'moki-docs-preview-frame',
          'data-testid': 'docs-preview-frame',
          src: loaded,
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
