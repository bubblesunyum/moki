import { useEffect, useState } from 'react'
import type { RpcNotificationMap } from '../../../../../../packages/protocol/src/index'
import { useRpcQuery } from './hooks'

type BridgeStatus = RpcNotificationMap['helper.status']['status']

/**
 * Helper status for the inspector footer (dev): follows the `helper.status`
 * bridge event for instant updates and polls `helper.ping` for the version;
 * shows `down` on any error.
 */
export function HelperStatus(): React.JSX.Element {
  const [status, setStatus] = useState<BridgeStatus | null>(null)

  useEffect(() => window.moki.on('helper.status', (params) => setStatus(params.status)), [])

  const query = useRpcQuery('helper.ping', undefined, {
    refetchInterval: 5000,
    retry: false
  })

  if (query.isPending && status !== 'down') {
    return <span role="status">helper …</span>
  }
  if (status === 'down' || query.isError || !query.data?.ok) {
    return <span role="status">helper down</span>
  }
  return <span role="status">helper ok · v{query.data.version}</span>
}
