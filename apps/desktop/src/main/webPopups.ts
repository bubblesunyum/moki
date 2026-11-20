import { app, BrowserWindow } from 'electron'
import { isExternalHttpUrl } from '../../../../packages/protocol/src/index'

/* Webview popups, Electron 45 path. The renderer-side `new-window` webview
 * event was removed in Electron 22, so a renderer listener never fires —
 * popups must be intercepted here instead, and the guest needs `allowpopups`
 * (set on the element in useWebviewGuest) for the attempt to happen at all.
 *
 * Every webview guest gets a window-open handler that denies the native
 * window and forwards the URL to the owning window, where the Day Web tile
 * opens it as a Peek. Only http(s) URLs leave main, and the renderer
 * re-validates with its strict allowlist before loading anything. */
export function setupWebviewPopups(): void {
  app.on('web-contents-created', (_event, contents) => {
    try {
      if (typeof contents.getType !== 'function' || contents.getType() !== 'webview') return
    } catch {
      return
    }
    contents.setWindowOpenHandler(({ url }) => {
      try {
        if (isExternalHttpUrl(url)) {
          /* hostWebContents is null for top-level windows; only webview
           * guests have one, and only webviews reach this handler. */
          const host = contents.hostWebContents
          const owner = host === null ? null : BrowserWindow.fromWebContents(host)
          if (owner !== null && !owner.isDestroyed()) {
            owner.webContents.send('rpc:notify', 'web.popup', { url })
          }
        }
      } catch {
        /* Never let a popup break the guest. */
      }
      return { action: 'deny' }
    })
  })
}
