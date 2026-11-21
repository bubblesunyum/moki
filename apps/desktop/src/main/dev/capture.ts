import { writeFile } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'

export interface CaptureSelection {
  threadId: string | undefined
  segment: string | undefined
  lens: string | undefined
  range: string | undefined
  peek: string | undefined
  scrollTo: string | undefined
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/* Dev-only capture selection: MOKI_THREAD=<thread id> opens that thread
 * instead of the first row; MOKI_SEGMENT=<email|text|...> opens that
 * Messages segment; MOKI_LENS=<lens id> opens that lens (e.g. day);
 * MOKI_DAY_RANGE=<today|tomorrow|week> opens that Day range;
 * MOKI_DAY_PEEK=<https url> opens the Web tile's Peek on that URL.
 * MOKI_SCROLL_TO=<test id> scrolls that data-testid into view (tall
 * lenses: e.g. the Docs sections below the fold).
 * Unset behaves exactly as today; unknown values fall back in the renderer
 * with a console warning, never a blank pane. */
export function captureSelectionFromEnv(env: NodeJS.ProcessEnv = process.env): CaptureSelection {
  return {
    threadId: trimToUndefined(env['MOKI_THREAD']),
    segment: trimToUndefined(env['MOKI_SEGMENT']),
    lens: trimToUndefined(env['MOKI_LENS']),
    range: trimToUndefined(env['MOKI_DAY_RANGE']),
    peek: trimToUndefined(env['MOKI_DAY_PEEK']),
    scrollTo: trimToUndefined(env['MOKI_SCROLL_TO'])
  }
}

/* Carry the selection to the renderer on the startup URL — the established
 * main->renderer channel, so no new IPC pipe. Absent values leave the URL
 * untouched. */
export function withCaptureSelection(url: string, selection: CaptureSelection): string {
  if (
    selection.threadId === undefined &&
    selection.segment === undefined &&
    selection.lens === undefined &&
    selection.range === undefined &&
    selection.peek === undefined &&
    selection.scrollTo === undefined
  )
    return url
  try {
    const parsed = new URL(url)
    if (selection.threadId !== undefined) parsed.searchParams.set('mokiThread', selection.threadId)
    if (selection.segment !== undefined) parsed.searchParams.set('mokiSegment', selection.segment)
    if (selection.lens !== undefined) parsed.searchParams.set('mokiLens', selection.lens)
    if (selection.range !== undefined) parsed.searchParams.set('mokiRange', selection.range)
    if (selection.peek !== undefined) parsed.searchParams.set('mokiPeek', selection.peek)
    if (selection.scrollTo !== undefined) parsed.searchParams.set('mokiScrollTo', selection.scrollTo)
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
  if (selection.range !== undefined) query['mokiRange'] = selection.range
  if (selection.peek !== undefined) query['mokiPeek'] = selection.peek
  if (selection.scrollTo !== undefined) query['mokiScrollTo'] = selection.scrollTo
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
