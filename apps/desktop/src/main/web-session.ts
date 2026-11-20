// The one shared `websites` session: every webview guest (Day tile, Peek,
// Docs preview, future tabs) lives here, never anywhere else, so a site's
// cookies and storage stay first-party and sign-in in one surface is visible
// in the others. Ported from the Gooey reference
// (../gooey/apps/desktop/src/main/web-session.ts): deny-all permissions except
// the async-clipboard write, cancel every download with a notice, and hold an
// http(s) allowlist on attach plus every main-frame navigation and redirect.
//
// Moki difference: popups are NOT opened as tab windows here. They stay
// denied at the native level and are forwarded to the owning window by
// webPopups.ts (deny-to-Peek), where the renderer re-validates before loading.
//
// Notion trap: IndexedDB corrupts with two Electron instances sharing this
// profile, so index.ts enforces the single-instance invariant
// (requestSingleInstanceLock + app.quit() for the second copy) before this
// session is ever created.
//
// Only installWebSession touches app/session, and only index.ts calls it.

import { app, session } from 'electron'
import type { DownloadItem, WebContents } from 'electron'
import { isExternalHttpUrl, WEBSITES_PARTITION } from '../../../../packages/protocol/src/index'

/* Re-exported so existing importers keep one source: the literal lives in
 * packages/protocol, not here — including the renderer's
 * day/widgets/webviewShared.ts, which aliases it as WEBVIEW_PARTITION. */
export { WEBSITES_PARTITION }

export interface WebDownloadNotice {
  kind: 'download-blocked'
  url: string
}

export interface WebSessionDeps {
  /** Downloads never save: main routes this to a user-visible notice. */
  notify: (notice: WebDownloadNotice) => void
}

/** The whole hardening story in one allowlist: only http(s) pages may ever
 * live in a guest. This is the protocol allowlist (isExternalHttpUrl) under
 * a main-side name, so the session hardener, the popup route (webPopups.ts)
 * and the preload can never disagree — padded URLs included. Default-deny:
 * null, missing and unparseable URLs are not http. */
export function isWebUrlAllowed(url: string | null | undefined): boolean {
  return isExternalHttpUrl(url)
}

/** Structural webPreferences for a webview about to attach: the page's
 * attributes plus whatever the embedder set, before the guest exists. Only
 * the keys the hardener touches are listed; anything else on the real object
 * passes through untouched. */
export interface WebviewAttachPrefs {
  preload?: string
  preloadURL?: string
  sandbox?: boolean
  contextIsolation?: boolean
  nodeIntegration?: boolean
  partition?: string
}

/** Structural will-attach-webview params: the webview's attributes. */
export interface WebviewAttachParams {
  src?: string
}

/** Force a webview's preferences into the hardened shape and say whether the
 * attach must be refused. Mutates prefs in place (that is what
 * will-attach-webview hands over): any page-set preload is gone, the guest is
 * sandboxed and isolated with no Node, and it lands in the websites session no
 * matter what partition the page asked for. Returns true when src is outside
 * the allowlist — the caller preventDefaults, which destroys the guest. */
export function sanitizeWebviewAttach(prefs: WebviewAttachPrefs, params: WebviewAttachParams): boolean {
  // A page-set preload would run its own script in the guest before the site
  // loads; preloadURL is the same slot under an older name. Neither survives.
  delete prefs.preload
  delete prefs.preloadURL
  prefs.sandbox = true
  prefs.contextIsolation = true
  prefs.nodeIntegration = false
  prefs.partition = WEBSITES_PARTITION
  return !isWebUrlAllowed(params.src)
}

/** The one async-clipboard permission a websites guest may hold. Electron
 * names the write side `clipboard-sanitized-write` (the `clipboard-write`
 * name pages query is the same grant); `clipboard-read` stays denied, so a
 * guest can never silently lift the clipboard. The sync execCommand
 * copy/paste path needs no grant and already works, so it is not listed. */
const WEB_CLIPBOARD_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

/** Whether a permission request from a websites guest is granted: only the
 * async-clipboard write, and only when the requester is an http(s) page.
 * Everything else — clipboard reads, camera, mic, location, notifications
 * and the rest — stays denied, and no non-web requester ever passes. Pure,
 * so the unit test proves it without Electron. */
export function shouldAllowWebPermission(
  permission: string,
  requestingUrl: string | null | undefined
): boolean {
  if (!WEB_CLIPBOARD_PERMISSIONS.has(permission)) return false
  return isWebUrlAllowed(requestingUrl)
}

/** Popup verdict: the same allowlist that hardens webviews decides — an
 * http(s) popup forwards to the Peek route, everything else
 * (file:, javascript:, data:, blob:, about:blank) denies, so a guest can
 * never smuggle a non-web URL into a window. Pure, so the unit test proves
 * it without Electron. */
export function decidePopupUrl(url: string): 'allow' | 'deny' {
  return isWebUrlAllowed(url) ? 'allow' : 'deny'
}

/** Create the websites session and guard every guest in it. The only
 * permission granted is the async-clipboard write on http(s) pages (so a
 * guest's copy button reaches the system clipboard); reads stay denied, and
 * camera, mic, location and the rest never prompt. Downloads cancel with a
 * notice, and the attach-time allowlist below keeps guarding every later
 * main-frame navigation and redirect. Popup interception stays in
 * webPopups.ts (deny-to-Peek), which shares decidePopupUrl above. */
export function installWebSession({ notify }: WebSessionDeps): void {
  const websites = session.fromPartition(WEBSITES_PARTITION, { cache: true })
  // Most web APIs check first and request on denial, so both handlers must
  // agree: each grants the async-clipboard write to http(s) requesters and
  // denies everything else. The requester's own URL decides (falling back
  // to the contents' URL, then the origin): a non-web requester never passes.
  websites.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(shouldAllowWebPermission(permission, details?.requestingUrl ?? contents.getURL()))
  })
  websites.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    return shouldAllowWebPermission(
      permission,
      details?.requestingUrl ?? contents?.getURL() ?? requestingOrigin
    )
  })
  websites.on('will-download', (event, item: DownloadItem) => {
    // A site's download never touches disk; the notice tells the user where
    // it went.
    event.preventDefault()
    notify({ kind: 'download-blocked', url: item.getURL() })
  })
  app.on('web-contents-created', (_event, contents: WebContents) => {
    if (contents.getType() !== 'webview') {
      /* Embedder window: harden every webview BEFORE it attaches — strip
       * page-set preloads, force sandbox/isolation/no-Node and the websites
       * partition, refuse non-http(s) src (the refusal destroys the guest).
       * Later navigations are guarded per guest below. */
      contents.on('will-attach-webview', (event, prefs, params) => {
        if (sanitizeWebviewAttach(prefs, params)) event.preventDefault()
      })
      return
    }
    contents.on('will-navigate', (details) => {
      if (!isWebUrlAllowed(details.url)) details.preventDefault()
    })
    contents.on('will-redirect', (details) => {
      if (!isWebUrlAllowed(details.url)) details.preventDefault()
    })
    contents.on('will-frame-navigate', (details) => {
      // Subframes are the site's own business (about:blank scaffolding, ad
      // frames); only the top page is held to the allowlist.
      if (details.isMainFrame && !isWebUrlAllowed(details.url)) details.preventDefault()
    })
  })
}
