import { writeFile } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'

/**
 * Dev-only: MOKI_CAPTURE=<path.png> writes a screenshot of the page once it has
 * settled (MOKI_CAPTURE_DELAY ms, default 3000), then MOKI_CAPTURE_QUIT=1 quits.
 * The page captures itself, so it works with the display locked or asleep —
 * which OS-level screen capture does not.
 */
export function captureWhenSettled(win: BrowserWindow, quit: () => void): void {
  const path = process.env['MOKI_CAPTURE']
  if (!path) return
  const delay = Number(process.env['MOKI_CAPTURE_DELAY'] ?? 3000)
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage()
        await writeFile(path, image.toPNG())
        console.log(`[capture] wrote ${path}`)
      } catch (err) {
        console.error(`[capture] failed: ${String(err)}`)
      }
      if (process.env['MOKI_CAPTURE_QUIT'] === '1') quit()
    }, delay)
  })
}
