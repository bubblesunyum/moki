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

export interface RpcMethodMap {
  'helper.ping': { params: void; result: { ok: boolean; version: string } }
  'accounts.list': { params: void; result: AccountsListResult }
}

export type RpcMethod = keyof RpcMethodMap
export type RpcParams<M extends RpcMethod> = RpcMethodMap[M]['params']
export type RpcResult<M extends RpcMethod> = RpcMethodMap[M]['result']

export interface RpcNotificationMap {
  'helper.status': { status: 'starting' | 'ok' | 'down' }
}

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
}
