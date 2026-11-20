// Shared main<->renderer<->helper RPC types.
//
// Every method the renderer can call is declared once here in
// `RpcMethodMap` and mirrored by a Swift handler in helper/.
// The renderer only talks to the helper through `window.moki.call`.

export const PROTOCOL_VERSION = 1 as const

export interface Account {
  address: string
  name?: string
  photoURL?: string
  status: 'ok' | 'auth_expired' | 'unreachable'
}

/** Whether the one-time import of psymail-mini's sign-ins has finished. */
export type PsymailImportStatus = 'done' | 'pending' | 'unavailable'

export interface AccountsListResult {
  accounts: Account[]
  psymailImport: PsymailImportStatus
}

export interface EmailAddress {
  name: string
  address: string
}

export interface ThreadSummary {
  id: string
  account: string
  from: EmailAddress
  subject: string
  snippet: string
  /** ISO8601 date string (newest message in the thread). */
  date: string
  unread: boolean
  messageCount: number
  pinned: boolean
  labelIds: string[]
}

export interface MailMessage {
  id: string
  from: EmailAddress
  to: EmailAddress[]
  cc: EmailAddress[]
  /** ISO8601 date string. */
  date: string
  html?: string | null
  text?: string | null
  isFromMe: boolean
}

export interface ThreadDetail {
  id: string
  account: string
  subject: string
  messages: MailMessage[]
}

export interface MailListThreadsParams {
  label: string
  cursor?: Record<string, string>
}

export interface MailListThreadsResult {
  threads: ThreadSummary[]
  next?: Record<string, string>
  unreachable: string[]
  authExpired: string[]
}

export interface MailGetThreadParams {
  account: string
  id: string
}

export interface CalendarEvent {
  id: string
  title: string
  /** ISO8601 date-time string (`YYYY-MM-DD` for all-day events). */
  start: string
  end: string
  calendar: string
  account?: string
}

export interface CalendarListEventsParams {
  /** RFC3339 lower bound (inclusive), e.g. `2026-11-20T00:00:00Z`. */
  timeMin: string
  /** RFC3339 upper bound (exclusive). */
  timeMax: string
}

export interface CalendarListEventsResult {
  events: CalendarEvent[]
  unreachable: string[]
  authExpired: string[]
}

/** One recent file in the Docs lens. Listing only — viewing happens in
 * the shared web-session guest at `openUrl`, so the URL must be http(s). */
export type DocSource = 'drive' | 'notion' | 'craft'

export interface DocItem {
  id: string
  title: string
  source: DocSource
  /** ISO8601 last-modified string. */
  updatedAt: string
  /** Absolute http(s) URL opened in the right-pane preview. */
  openUrl: string
}

export interface DocsListRecentsParams {
  source: DocSource
}

export interface DocsListRecentsResult {
  items: DocItem[]
  /** The source was reachable but this slice failed — fixtures/partial UI. */
  unreachable: boolean
  /** The source needs a sign-in (per-section signed-out state). */
  signedOut: boolean
}

/** One Notion row proxied through the helper. The integration token lives
 * in the helper Keychain and never appears in any of these shapes —
 * `listRecents` reports status only. */
export interface NotionRecent {
  id: string
  title: string
  url?: string | null
  /** "page" or "database" (database mapping is out of scope for v1). */
  object: string
  /** ISO8601 last-edited string. */
  lastEditedTime: string
}

export type NotionRecentsStatus = 'ok' | 'signed_out' | 'auth_expired'

/** `notion.listRecents` never throws for auth states — they travel in the
 * envelope so the Docs lens can render its sign-in affordance. Only network
 * failures (`unreachable`/`rate_limited`) and malformed params throw, via
 * the shared `RpcErrorShape` with `data.code` (`rate_limited` included). */
export interface NotionListRecentsResult {
  status: NotionRecentsStatus
  items: NotionRecent[]
}

export interface NotionSetTokenParams {
  token: string
}

export interface RpcMethodMap {
  'helper.ping': { params: void; result: { ok: boolean; version: string } }
  'accounts.list': { params: void; result: AccountsListResult }
  'mail.listThreads': { params: MailListThreadsParams; result: MailListThreadsResult }
  'mail.getThread': { params: MailGetThreadParams; result: ThreadDetail }
  'calendar.listEvents': { params: CalendarListEventsParams; result: CalendarListEventsResult }
  'docs.listRecents': { params: DocsListRecentsParams; result: DocsListRecentsResult }
  'notion.listRecents': { params: void; result: NotionListRecentsResult }
  'notion.setToken': { params: NotionSetTokenParams; result: { ok: boolean } }
  'notion.signOut': { params: void; result: { ok: boolean } }
}

export type RpcMethod = keyof RpcMethodMap
export type RpcParams<M extends RpcMethod> = RpcMethodMap[M]['params']
export type RpcResult<M extends RpcMethod> = RpcMethodMap[M]['result']

export interface RpcNotificationMap {
  'helper.status': { status: 'starting' | 'ok' | 'down' }
  'day.clipboardChanged': { entry: DayClipboardEntry }
  /* A webview guest asked for a popup (window.open / target=_blank). Main
   * denies the native window; the Day Web tile opens it as a Peek after
   * re-validating the URL with its strict allowlist. */
  'web.popup': { url: string }
  /* A right-click landed on a webview guest page (the embedder never sees
   * guest input). The Day Web tile toggles its toolbar on it. Carries the
   * guest's webContentsId so the tile ignores other guests' signals
   * (notably its own Peek's). */
  'web.contextMenu': { guestId: number }
}

/** Live Day-lens entries served by the Electron main process. */

export interface DayClipboardEntry {
  id: string
  text: string
  copiedAt: number
}

export interface DayDownloadsEntry {
  name: string
  fullPath: string
  mtimeMs: number
  isDir: boolean
}

export interface DayUsageWindow {
  /** 0–100. */
  percent: number
  /** ISO8601 reset time, or null when the server omits it. */
  resetsAt: string | null
  limited?: boolean
}

export interface DayUsageResult {
  status: 'live' | 'missing-login' | 'unavailable'
  rolling?: DayUsageWindow
  weekly?: DayUsageWindow
  monthly?: DayUsageWindow
  /** Last good live snapshot, kept so the widget can label stale data. */
  lastGood?: { rolling?: DayUsageWindow; weekly?: DayUsageWindow; monthly?: DayUsageWindow }
  message?: string
}

export interface DaySystemProcess {
  pid: number
  /** Recent %CPU as reported by ps. */
  cpu: number
  name: string
}

export interface DaySystemResult {
  /** Null until the second sample (needs a busy/total delta). */
  cpuPercent: number | null
  cpuCores: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  memoryPressure: 'normal' | 'warning' | 'critical'
  /** Null on desktops / when no battery is present. */
  batteryPercent: number | null
  batteryCharging: boolean | null
  /** Minutes remaining, or null when unknown. */
  batteryMinutesLeft: number | null
  breakdown: DaySystemProcess[]
  sampledAt: number
}

/** Main-process (`day:call`) methods: live Day data, no helper involved. */
export interface DayLocalMap {
  'day.clipboardList': { params: void; result: { entries: DayClipboardEntry[] } }
  'day.clipboardClear': { params: void; result: { ok: true } }
  'day.downloadsList': { params: { showHidden?: boolean } | void; result: { entries: DayDownloadsEntry[] } }
  'day.openPath': { params: { path: string }; result: { ok: true } }
  'day.revealPath': { params: { path: string }; result: { ok: true } }
  'day.usageGet': { params: void; result: DayUsageResult }
  'day.systemGet': { params: void; result: DaySystemResult }
}

export type DayLocalMethod = keyof DayLocalMap
export type DayLocalParams<M extends DayLocalMethod> = DayLocalMap[M]['params']
export type DayLocalResult<M extends DayLocalMethod> = DayLocalMap[M]['result']

export type RpcNotificationName = keyof RpcNotificationMap
export type RpcNotificationParams<N extends RpcNotificationName> = RpcNotificationMap[N]

/** Shared JSON-RPC error shape. App errors carry `data.code` (e.g. `auth_expired`). */
export interface RpcErrorShape {
  code: number
  message: string
  data?: { code?: string }
}

/** True for absolute http(s) URLs safe to hand to `shell.openExternal`. */
export function isExternalHttpUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\/[^/\s]/i.test(url.trim())
}

/** The one persisted session partition every web surface shares (Day tile,
 * Peek, Docs preview, future tabs): one cookie jar, one sign-in. Guests only
 * take effect with this exact string at creation, so every embedder —
 * main (`web-session.ts`, `zenCookies.shared.ts`) and renderer
 * (`webviewShared.ts`) — must stay on this same literal. Defined once here;
 * main re-exports it, and the renderer cutover is a follow-up. */
export const WEBSITES_PARTITION = 'persist:moki-websites' as const

/** Typed `window.moki` bridge exposed by the preload. */
export interface MokiApi {
  call<M extends RpcMethod>(method: M, params?: RpcParams<M>): Promise<RpcResult<M>>
  on<N extends RpcNotificationName>(
    event: N,
    cb: (params: RpcNotificationParams<N>) => void
  ): () => void
  openExternal(url: string): Promise<void>
  /** Main-process Day methods over the `day:call` channel (no helper). */
  local<M extends DayLocalMethod>(method: M, params?: DayLocalParams<M>): Promise<DayLocalResult<M>>
}
