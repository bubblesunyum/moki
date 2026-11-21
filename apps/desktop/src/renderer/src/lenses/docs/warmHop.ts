import { originOf } from '../day/widgets/webviewShared'

/* Warm-hop policy for the docs pane: the only apps whose same-origin
 * picks keep the live guest and hop in-page. A synthetic
 * pushState+popstate only loads the target page when the running app
 * services the popstate itself — Notion and Craft's editors route that
 * way (live-confirmed, mok-ic6); Drive file views and Docs editors don't
 * (browser clicks between them are full loads), so a hop there strands
 * the pane on the old doc while its chrome claims the new one, and the
 * synthetic event can send the guest's history machinery into a spin
 * (mok-tlq). Everything else — and every cross-app pick — commits src:
 * a real load, always correct.
 *
 * Docs policy, deliberately lens-local: the shared webview plumbing
 * stays mechanism-only; this list says which apps this pane trusts.
 * docs.google.com looks like "just Drive" but its editor links never
 * route a popstate — add an origin only after a live hop is confirmed
 * against it. Notion needs both domains: live rows carry the API's page
 * url verbatim (www.notion.com, live hop confirmed mok-ono), while
 * fixtures and the helper's fallback build www.notion.so.
 * Unparseable URLs resolve to their raw string, which never matches —
 * they stay cold. */
export const WARM_HOP_ORIGINS: ReadonlySet<string> = new Set([
  'https://www.notion.so',
  'https://www.notion.com',
  'https://docs.craft.do'
])

export function isWarmHopOrigin(url: string): boolean {
  return WARM_HOP_ORIGINS.has(originOf(url))
}
