import { writeFile } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'

export interface CaptureSelection {
  threadId: string | undefined
  segment: string | undefined
  lens: string | undefined
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/* Dev-only capture selection: MOKI_THREAD=<thread id> opens that thread
 * instead of the first row; MOKI_SEGMENT=<email|text|...> opens that
 * Messages segment; MOKI_LENS=<lens id> opens that lens (e.g. day).
 * Unset behaves exactly as today; unknown values fall back in the renderer
 * with a console warning, never a blank pane. */
export function captureSelectionFromEnv(env: NodeJS.ProcessEnv = process.env): CaptureSelection {
  return {
    threadId: trimToUndefined(env['MOKI_THREAD']),
    segment: trimToUndefined(env['MOKI_SEGMENT']),
    lens: trimToUndefined(env['MOKI_LENS'])
  }
}

/* Carry the selection to the renderer on the startup URL — the established
 * main->renderer channel, so no new IPC pipe. Absent values leave the URL
 * untouched. */
export function withCaptureSelection(url: string, selection: CaptureSelection): string {
  if (
    selection.threadId === undefined &&
    selection.segment === undefined &&
    selection.lens === undefined
  )
    return url
  try {
    const parsed = new URL(url)
    if (selection.threadId !== undefined) parsed.searchParams.set('mokiThread', selection.threadId)
    if (selection.segment !== undefined) parsed.searchParams.set('mokiSegment', selection.segment)
    if (selection.lens !== undefined) parsed.searchParams.set('mokiLens', selection.lens)
    return parsed.toString()
  } catch {
    return url
  }
}

/* Query form of the selection for loadFile: file URLs carry their params
 * as load options rather than a hand-built search string. */
export function captureSelectionQuery(selection: CaptureSelection): Record<string, string> {
  const query: Record<string, string> = {}
  if (selection.threadId !== undefined) query['mokiThread'] = selection.threadId
  if (selection.segment !== undefined) query['mokiSegment'] = selection.segment
  if (selection.lens !== undefined) query['mokiLens'] = selection.lens
  return query
}

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
