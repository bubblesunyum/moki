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

export interface RpcMethodMap {
  'helper.ping': { params: void; result: { ok: boolean; version: string } }
  'accounts.list': { params: void; result: AccountsListResult }
  'mail.listThreads': { params: MailListThreadsParams; result: MailListThreadsResult }
  'mail.getThread': { params: MailGetThreadParams; result: ThreadDetail }
  'calendar.listEvents': { params: CalendarListEventsParams; result: CalendarListEventsResult }
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
