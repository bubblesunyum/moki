import { app, BrowserWindow } from 'electron'
/* The popup verdict comes from the central web-session module, so the route
 * and the session hardener can never disagree: http(s) forwards to the Peek,
 * everything else denies. */
import { decidePopupUrl } from './web-session'

/* Webview popups, Electron 45 path. The renderer-side `new-window` webview
 * event was removed in Electron 22, so a renderer listener never fires —
 * popups must be intercepted here instead, and the guest needs `allowpopups`
 * (declarative prop on the element) for the attempt to happen at all.
 *
 * Every webview guest gets a window-open handler that denies the native
 * window and forwards the URL to the owning window, where the Day Web tile
 * opens it as a Peek. Only http(s) URLs leave main, and the renderer
 * re-validates with its strict allowlist before loading anything.
 *
 * Guest right-clicks never reach the embedder (input goes to the guest
 * process), so each guest also forwards `context-menu` — the Day Web tile
 * toggles its toolbar on it. The guest's own menu is left alone; only the
 * signal crosses, never any menu content.
 *
 * Tracing: set MOKI_WEB_POPUPS_DEBUG=1 in the dev environment for
 * per-popup main-process lines while diagnosing a flow. Hosts only, never
 * URLs — popup/auth flows routinely carry single-use codes and tokens in
 * query params, which must never reach logs or stdout. */
function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname || 'unparseable'
  } catch {
    return 'unparseable'
  }
}
export function setupWebviewPopups(): void {
  const debug = process.env['MOKI_WEB_POPUPS_DEBUG'] === '1'
  const log = (...args: unknown[]): void => {
    if (debug) console.log('[webPopups]', ...args)
  }
  log('hook installed')
  app.on('web-contents-created', (_event, contents) => {
    try {
      if (typeof contents.getType !== 'function' || contents.getType() !== 'webview') return
    } catch {
      return
    }
    log('guest seen, attaching window-open handler')
    const notifyOwner = (
      method: 'web.popup' | 'web.contextMenu',
      params: { url: string } | { guestId: number }
    ): void => {
      try {
        /* hostWebContents is null for top-level windows; only webview
         * guests have one, and only webviews reach this handler. */
        const host = contents.hostWebContents
        const owner = host === null ? null : BrowserWindow.fromWebContents(host)
        if (owner !== null && !owner.isDestroyed()) {
          owner.webContents.send('rpc:notify', method, params)
        }
      } catch (err) {
        log(`notify ${method} threw: ${String(err)}`)
      }
    }
    contents.setWindowOpenHandler(({ url, disposition }) => {
      const host = hostOfUrl(url)
      log(`window-open host=${host} disposition=${disposition}`)
      try {
        if (decidePopupUrl(url) === 'allow') {
          notifyOwner('web.popup', { url })
          log('forwarded to owner window')
        } else {
          log('non-http(s), denied silently')
        }
      } catch (err) {
        log(`handler threw: ${String(err)}`)
      }
      return { action: 'deny' }
    })
    contents.on('context-menu', () => {
      log('guest context-menu, forwarding toggle signal')
      notifyOwner('web.contextMenu', { guestId: contents.id })
    })
  })
}
