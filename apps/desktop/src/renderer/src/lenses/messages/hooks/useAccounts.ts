import { useRpcQuery } from '../../../rpc/hooks'

/** Gmail accounts behind the list pane's signed-out and partial states. */
export function useAccounts() {
  return useRpcQuery('accounts.list')
}
