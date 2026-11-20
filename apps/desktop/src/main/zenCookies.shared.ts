/* Zen cookie import — shared channel + status shapes.
 *
 * Dependency-free on purpose: both the main module (zenCookies.ts) and the
 * sandboxed preload import from here. Nothing secret crosses on this
 * channel — the renderer only ever sees per-host-group ok/failed plus
 * counts, never cookie names, hosts, or values. */

export const ZEN_COOKIES_CHANNEL = 'zen-cookies:import'

/* The literal lives in packages/protocol — the renderer cutover
 * (webviewShared.WEBVIEW_PARTITION) is a follow-up owned by another worker.
 * Cookies land here so Docs previews (and future tabs) start signed in. */
export { WEBSITES_PARTITION as SHARED_WEB_SESSION_PARTITION } from '../../../../packages/protocol/src/index'

export type ZenHostGroup = 'google' | 'notion' | 'craft'

export const ZEN_HOST_GROUPS: readonly ZenHostGroup[] = ['google', 'notion', 'craft']

export type ZenGroupState = 'ok' | 'failed'

/* Renderer-visible result only: per-group ok/failed plus counts. No names,
 * hosts, or values — those stay in main. */
export interface ZenCookieImportStatus {
  groups: Record<ZenHostGroup, ZenGroupState>
  imported: number
  skipped: number
}

export function failedImportStatus(): ZenCookieImportStatus {
  return { groups: { google: 'failed', notion: 'failed', craft: 'failed' }, imported: 0, skipped: 0 }
}
