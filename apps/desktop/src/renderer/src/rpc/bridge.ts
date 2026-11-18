import type {
  MokiApi,
  RpcMethod,
  RpcNotificationName,
  RpcNotificationParams,
  RpcParams,
  RpcResult
} from '../../../../../../packages/protocol/src/index'

/* Single guard for a missing preload bridge (plain browser, broken
 * preload): every renderer access to `window.moki` goes through here so
 * the app renders a quiet fallback instead of throwing. */
export function getBridge(): MokiApi | null {
  const candidate = (window as unknown as { moki?: MokiApi }).moki
  return candidate ?? null
}

/** Typed `call` that rejects with `no bridge` when the preload is missing. */
export function callBridge<M extends RpcMethod>(
  method: M,
  params?: RpcParams<M>
): Promise<RpcResult<M>> {
  const bridge = getBridge()
  if (!bridge) return Promise.reject(new Error('no bridge'))
  return bridge.call(method, params)
}

/** Typed `on` that returns a noop unsubscribe when the preload is missing. */
export function onBridge<N extends RpcNotificationName>(
  event: N,
  cb: (params: RpcNotificationParams<N>) => void
): () => void {
  const bridge = getBridge()
  if (!bridge) return () => {}
  return bridge.on(event, cb)
}
