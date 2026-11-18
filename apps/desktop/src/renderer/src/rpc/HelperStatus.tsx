import { useEffect, useState } from 'react'
import type { RpcNotificationMap } from '../../../../../../packages/protocol/src/index'
import { getBridge, onBridge } from './bridge'
import { useRpcQuery } from './hooks'

type BridgeStatus = RpcNotificationMap['helper.status']['status']

/**
 * Helper status for the inspector footer (dev): follows the `helper.status`
 * bridge event for instant updates and polls `helper.ping` for the version;
 * shows `down` on any error, and a quiet `no bridge` when the preload did
 * not install `window.moki` (plain browser, broken preload).
 */
export function HelperStatus(): React.JSX.Element {
  const [status, setStatus] = useState<BridgeStatus | null>(null)

  useEffect(() => onBridge('helper.status', (params) => setStatus(params.status)), [])

  const query = useRpcQuery('helper.ping', undefined, {
    refetchInterval: 5000,
    retry: false
  })

  if (getBridge() === null) {
    return <span role="status">helper no bridge</span>
  }

  if (query.isPending && status !== 'down') {
    return <span role="status">helper …</span>
  }
  if (status === 'down' || query.isError || !query.data?.ok) {
    return <span role="status">helper down</span>
  }
  return <span role="status">helper ok · v{query.data.version}</span>
}
