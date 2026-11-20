/* Shared webview plumbing for the Day Web tile and its Peek overlay.
 * Pure address helpers plus the sandbox constants, so both surfaces load
 * with the same partition, prefs and https-only allowlist. */

export const WEBVIEW_STORAGE_KEY = 'moki.day.webview.home'
export const WEBVIEW_HOME_DEFAULT = 'https://example.com'
export const WEBVIEW_PARTITION = 'persist:moki-websites'
export const WEBVIEW_PREFS = 'contextIsolation=yes, sandbox=yes'

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

export function validateWebviewHome(raw: unknown): string | null {
  return typeof raw === 'string' ? normalizeAddress(raw) : null
}

export function loadWebviewHome(): string {
  try {
    const raw = window.localStorage.getItem(WEBVIEW_STORAGE_KEY)
    if (typeof raw !== 'string') return WEBVIEW_HOME_DEFAULT
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = raw
    }
    return validateWebviewHome(parsed) ?? WEBVIEW_HOME_DEFAULT
  } catch {
    /* Storage blocked — fall back to the default home. */
    return WEBVIEW_HOME_DEFAULT
  }
}

/* Host for the Peek title bar; falls back to the full URL when parsing
 * fails so the bar never renders empty. */
export function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname
    return host === '' ? url : host
  } catch {
    return url
  }
}

/* Secure indicator for the Peek title bar: only https earns the lock.
 * Plain http pages load, but never with a lock. */
export function isSecureUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}
