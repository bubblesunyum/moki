import { createElement, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getBridge } from '../../../rpc/bridge'
import { SHELL_CONTENT_CLASS } from '../../../shell/Shell'
import { Icon, IconButton, Text } from '../../../ui'
import { useSandboxedWebview } from './useWebviewGuest'
import { hostOf, isSecureUrl, WEBVIEW_GUEST_ATTRS } from './webviewShared'

export interface WebPeekProps {
  url: string
  onClose(): void
  onExpand(url: string): void
}

/* Arc-style Peek: the popup floats as a centered card over a dimmed
 * backdrop while the board stays behind. Portal target is the shell
 * content area, so the Peek covers the screen area only — the sidebar
 * (and inspector) stay visible and interactive; falls back to body
 * outside the shell (tests). The tile is a GlassPane (backdrop-filter),
 * which would otherwise become the containing block and trap the card
 * in the tile. Esc, backdrop click and the X all dismiss; Expand promotes
 * the peeked page into the tile; the browser button sends it outside.
 * Same partition as the tile, so a sign-in started in the peek finishes
 * logged in. */
function peekPortalTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  try {
    return document.querySelector<HTMLElement>(`.${SHELL_CONTENT_CLASS}`) ?? document.body
  } catch {
    return document.body
  }
}
export function WebPeek({ url, onClose, onExpand }: WebPeekProps): React.JSX.Element | null {
  const [current, setCurrent] = useState<string>(url)
  const currentRef = useRef<string>(url)
  const cardRef = useRef<HTMLDivElement | null>(null)
  /* Resolved once in a mount effect and kept stable: a render-phase
   * lookup would run pre-commit (nothing mounted yet), so a cold-open
   * Peek (?mokiPeek=) would pin the body fallback forever and cover the
   * sidebar. Post-commit the shell exists in every path, and the target
   * never moves after — moving it would destroy the live guest mid-load.
   * The first commit renders nothing (one frame, invisible on open). */
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setPortalTarget(peekPortalTarget())
  }, [])

  /* Auth redirects stay in the peek: follow validated navigations so the
   * title bar and Expand track where the flow actually landed. Popups from
   * inside the peek route through main back to the tile, which swaps the
   * peek content — no peek-in-peek. */
  const { setView, go } = useSandboxedWebview({
    onNavigate: (next) => {
      currentRef.current = next
      setCurrent(next)
    }
  })

  /* Prop callbacks ride refs so this mount-only effect never goes stale or
   * re-runs mid-peek (which would steal and restore focus every render). */
  const closeRef = useRef(onClose)
  const expandRef = useRef(onExpand)
  useEffect(() => {
    closeRef.current = onClose
    expandRef.current = onExpand
  })

  /* Dialog semantics: focus the card on open, trap Tab inside it, restore
   * the tile's focus on dismiss. Esc closes, ⌘/Ctrl-O keeps the page.
   * Re-runs when the portal target resolves so the card exists — the
   * target is set once, so this still runs exactly once per mount. */
  useEffect(() => {
    if (portalTarget === null) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    try {
      cardRef.current?.focus()
    } catch {
      /* Focus is best-effort — Esc still works via the window listener. */
    }
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        expandRef.current(currentRef.current)
        return
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const focusables = Array.from(
        card.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      /* Focus on the card itself counts as outside — it is the entry
       * point, not a control. */
      const onControl = active !== null && active !== card && card.contains(active)
      if (e.shiftKey && (!onControl || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!onControl || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      try {
        previouslyFocused?.focus()
      } catch {
        /* The tile may be gone — leaving focus where it landed is fine. */
      }
    }
  }, [portalTarget])

  function openOutside(): void {
    getBridge()?.openExternal(current).catch(() => undefined)
  }

  if (typeof document === 'undefined' || portalTarget === null) return null
  return createPortal(
    <div
      className="moki-peek-backdrop"
      data-testid="web-peek"
      onMouseDown={(e) => {
        /* Left button only: right-click is not a dismiss (and the tile's
         * new semantic reserves it for revealing controls). */
        if (e.button !== 0 || e.target !== e.currentTarget) return
        onClose()
      }}
      /* Portal events bubble through the React tree, not the DOM: without
       * this, right-clicks in the Peek would reach the tile's toggle
       * handler and flip the hidden toolbar behind the overlay. */
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div
        ref={cardRef}
        className="moki-peek-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${hostOf(current)}`}
        tabIndex={-1}
      >
        <div className="moki-peek-head">
          <div className="moki-peek-nav" role="toolbar" aria-label="Preview navigation">
            <IconButton icon="chevron-left" label="Back" size="sm" iconSize={16} onClick={() => go('back')} />
            <IconButton
              icon="chevron-right"
              label="Forward"
              size="sm"
              iconSize={16}
              onClick={() => go('forward')}
            />
            <IconButton icon="rotate-cw" label="Reload" size="sm" iconSize={16} onClick={() => go('reload')} />
          </div>
          <Text variant="small" as="p" className="moki-peek-host" title={current}>
            {isSecureUrl(current) ? <Icon name="lock" size={12} aria-hidden /> : null} {hostOf(current)}
          </Text>
          <div className="moki-peek-actions" role="toolbar" aria-label="Preview actions">
            <IconButton
              icon="expand"
              label="Open in tile"
              title="Keep this page in the tile (⌘O)"
              size="sm"
              iconSize={16}
              onClick={() => onExpand(current)}
            />
            <IconButton
              icon="external-link"
              label="Open in browser"
              size="sm"
              iconSize={16}
              onClick={openOutside}
            />
            <IconButton icon="x" label="Close preview" title="Close (Esc)" size="sm" iconSize={16} onClick={onClose} />
          </div>
        </div>
        {createElement('webview', {
          ref: setView,
          className: 'moki-peek-frame',
          'data-testid': 'web-peek-frame',
          src: url,
          ...WEBVIEW_GUEST_ATTRS
        })}
      </div>
    </div>,
    portalTarget
  )
}
