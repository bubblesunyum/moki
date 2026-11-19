import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { isExternalHttpUrl } from '../../../../../../../../packages/protocol/src/index'
import { getBridge } from '../../../rpc/bridge'
import { sanitizeEmailHtml } from './sanitize'

/* Shadow-root stylesheet for HTML email bodies. Custom properties inherit
 * through the shadow boundary, so the brief's tokens resolve inside. Email
 * CSS is scoped under .moki-email-content (see sanitize.ts, which rewrites
 * :host/::slotted out of email <style>); the !important display/visibility
 * below keeps our base styles winning so a hostile rule can never hide or
 * restyle the card container itself. */
const SHADOW_CSS = [
  ':host{display:block;font-family:var(--moki-font);font-size:15px;font-weight:400;line-height:1.55;color:var(--moki-color-ink);overflow-wrap:anywhere}',
  '.moki-email-content{display:block!important;visibility:visible!important}',
  'a{color:var(--moki-accent-cyan)}',
  'img{max-width:100%;height:auto}',
  'pre{white-space:pre-wrap}',
  'blockquote{margin:8px 0;padding-left:12px;border-left:2px solid var(--moki-divider-line)}',
  'table{border-collapse:collapse;max-width:100%}',
  'td,th{border:1px solid var(--moki-divider-line);padding:4px 8px}'
].join('')

/* http(s) only — the preload rejects anything else, so check first and
 * swallow bridge failures. Non-http(s) links are inert by design. */
function openExternalUrl(href: string | null): void {
  if (!isExternalHttpUrl(href)) return
  getBridge()?.openExternal(href).catch(() => undefined)
}

function openFromAnchor(e: ReactMouseEvent<HTMLAnchorElement>, href: string): void {
  e.preventDefault()
  openExternalUrl(href)
}

function HtmlBody({ html }: { html: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host == null) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    // The sanitized body renders inside an inner container: email <style>
    // (already stripped of :host/::slotted) can only reach this container,
    // never our host element, and the base stylesheet above keeps the
    // container displayed.
    root.innerHTML = `<style>${SHADOW_CSS}</style><div class="moki-email-content">${sanitizeEmailHtml(html)}</div>`
    // Listen on the shadow root itself: clicks retarget to the host for
    // listeners outside, so only an inside listener sees the real anchor.
    const onClick = (e: Event): void => {
      if (!(e.target instanceof Element)) return
      const anchor = e.target.closest('a')
      if (anchor == null) return
      e.preventDefault()
      e.stopPropagation()
      openExternalUrl(anchor.getAttribute('href'))
    }
    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('click', onClick)
    }
  }, [html])

  return <div ref={hostRef} className="moki-email-html" data-testid="email-html" />
}

const URL_PATTERN = /https?:\/\/[^\s<>()"']+/g

function splitLinks(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0]
    const start = match.index ?? 0
    // Trailing punctuation is rarely part of a URL ("see https://a.b/c.").
    const trimmed = raw.replace(/[.,;:!?)\]]+$/u, '')
    const trail = raw.slice(trimmed.length)
    if (start > last) out.push(text.slice(last, start))
    if (trimmed.length > 0) {
      out.push(
        <a key={key++} href={trimmed} onClick={(e) => openFromAnchor(e, trimmed)}>
          {trimmed}
        </a>
      )
    }
    if (trail !== '') out.push(trail)
    last = start + raw.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function PlainBody({ text }: { text: string }): React.JSX.Element {
  if (text.trim() === '') {
    return (
      <div className="moki-email-plain moki-email-empty" data-testid="email-text">
        (empty message)
      </div>
    )
  }
  return (
    <div className="moki-email-plain" data-testid="email-text">
      {splitLinks(text)}
    </div>
  )
}

export interface EmailBodyProps {
  html?: string | null
  text?: string | null
}

/* HTML wins when present; plain text renders pre-wrapped with autolinked
 * http(s) URLs. Both open links through window.moki.openExternal. */
export function EmailBody({ html, text }: EmailBodyProps): React.JSX.Element {
  if (html != null && html.trim() !== '') {
    return <HtmlBody html={html} />
  }
  return <PlainBody text={text ?? ''} />
}
