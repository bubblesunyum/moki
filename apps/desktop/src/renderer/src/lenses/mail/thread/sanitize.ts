import DOMPurify from 'dompurify'

/* Tags that must never survive into an email card. `<style>` and inline
 * `style` stay allowed: the body renders inside a shadow root, so email CSS
 * cannot leak into the app. Event-handler attributes (`on*`) and
 * `javascript:` URLs are stripped by DOMPurify's defaults; the tests pin
 * that down. */
const FORBID_TAGS = [
  'script',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'fieldset',
  'option',
  'optgroup',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'base'
]

let imageHookInstalled = false

/* Remote images stay, but load without a referrer. Registered once:
 * DOMPurify keeps a global hook list, so adding it per call would stack
 * duplicates. Policy is psymail parity: direct-load everything in the body
 * (psymail gates nothing — tracker filtering lives only in its preview-image
 * picks, never in body rendering). */
function ensureImageHook(): void {
  if (imageHookInstalled) return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'IMG') return
    const src = node.getAttribute('src')?.trim() ?? ''
    if (/^https?:\/\//i.test(src)) {
      node.setAttribute('referrerpolicy', 'no-referrer')
    }
  })
  imageHookInstalled = true
}

/** Sanitize an email HTML body for rendering inside a shadow root. */
export function sanitizeEmailHtml(dirty: string): string {
  ensureImageHook()
  const clean = DOMPurify.sanitize(dirty, {
    FORBID_TAGS,
    // `<style>` is safe here: the body renders inside a shadow root, so
    // email CSS cannot leak into the app.
    ADD_TAGS: ['style'],
    // Full email documents carry their CSS in <head>; without this the
    // parser files it outside the sanitized body and the card loses it.
    FORCE_BODY: true,
    // Block form submission targets even if a form-adjacent tag gets through.
    FORBID_ATTR: ['action', 'formaction', 'srcdoc']
  })
  return neutralizeStyleBlocks(clean)
}

/* Shadow-piercing selectors must not survive: inside the shadow root an
 * email `:host` rule targets our host element (e.g. `:host{display:none}`
 * would hide the whole card) and `::slotted` can reach the light DOM.
 * Rewritten to a tag that never matches, so the declaration block is
 * dropped by the parser with no effect. Exported for tests. */
export function neutralizeShadowPiercingSelectors(css: string): string {
  return css
    .replace(/::slotted\s*\([^)]*\)/gi, 'x-moki-removed')
    .replace(/::slotted\b/gi, 'x-moki-removed')
    .replace(/:host-context\s*\([^)]*\)/gi, 'x-moki-removed')
    .replace(/:host\s*\([^)]*\)/gi, 'x-moki-removed')
    .replace(/:host\b/gi, 'x-moki-removed')
}

function neutralizeStyleBlocks(html: string): string {
  return html.replace(
    /<style([^>]*)>([\s\S]*?)<\/style>/gi,
    (_match, attrs: string, css: string) =>
      `<style${attrs}>${neutralizeShadowPiercingSelectors(css)}</style>`
  )
}
