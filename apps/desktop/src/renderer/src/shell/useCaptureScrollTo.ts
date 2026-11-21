import { useEffect } from 'react'

/* Capture override (dev only, via ?mokiScrollTo=<data-testid> on the
 * startup URL, mirroring ?mokiLens=): scrolls the first element carrying
 * that test id into view once it exists. Sections settle asynchronously
 * (skeletons become rows, sections grow), so the scroll re-fires briefly
 * to keep the target pinned while content above it moves — a capture
 * delay of a few seconds then photographs the intended region, not the
 * top of the pane. Absent from production URLs, the interval never
 * starts; a value no element ever carries warns once after the window
 * and leaves the scroll wherever the lens left it. */

const POLL_MS = 400
/* ~20s: live sections settle well inside this even with slow sources. */
const MAX_ATTEMPTS = 50
const TEST_ID_CHARS = /^[-A-Za-z0-9_]+$/

export function useCaptureScrollTo(): void {
  useEffect(() => {
    let raw: string | undefined
    try {
      raw = new URLSearchParams(window.location.search).get('mokiScrollTo')?.trim()
    } catch {
      return
    }
    if (raw === undefined || raw === '') return
    if (!TEST_ID_CHARS.test(raw)) {
      console.warn(`[capture] ignoring mokiScrollTo="${raw}" — not a test id`)
      return
    }
    let attempts = 0
    const timer = window.setInterval(() => {
      const el = document.querySelector(`[data-testid="${raw}"]`)
      if (el !== null) {
        el.scrollIntoView({ block: 'start' })
        return
      }
      attempts += 1
      if (attempts >= MAX_ATTEMPTS) {
        window.clearInterval(timer)
        console.warn(`[capture] unknown mokiScrollTo="${raw}" — no element carried that test id`)
      }
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [])
}
