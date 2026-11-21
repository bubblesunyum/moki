import type { DocItem, DocSource } from '../../../../../../../packages/protocol/src/index'
import { useRpcQuery } from '../../rpc/hooks'
import { getBridge } from '../../rpc/bridge'
import { DOC_FIXTURES } from './fixtures'

/* One source's recents: three parallel calls (Drive, Notion, Craft) each
 * keyed by source. Fixtures are the data only with no bridge (tests, plain
 * browser); with a bridge, a live result wins and an RPC error empties the
 * section into the partial state — never fixture rows posing as the user's
 * docs. Signed-out empties the section into its sign-in state instead of
 * showing stale rows.
 *
 * Status drives the per-section copy: loading skeletons, quiet ready rows,
 * one-line partial/unreachable notices, and the signed-out prompt. */

export type DocsSectionStatus = 'loading' | 'ready' | 'partial' | 'signed-out' | 'unreachable'

export interface DocsRecents {
  items: DocItem[]
  status: DocsSectionStatus
}

export function useDocsRecents(source: DocSource): DocsRecents {
  const hasBridge = getBridge() !== null
  const query = useRpcQuery(
    'docs.listRecents',
    { source },
    { enabled: hasBridge, retry: false, staleTime: Infinity }
  )
  if (!hasBridge) return { items: DOC_FIXTURES[source], status: 'ready' }
  if (query.isPending) return { items: [], status: 'loading' }
  /* With a bridge, an RPC error is empty rows plus the partial notice —
   * fixture rows must never pose as the user's docs. */
  if (query.isError) return { items: [], status: 'partial' }
  const data = query.data
  if (data.signedOut) {
    /* Signed out but a saved list came back with the payload: keep the rows
     * up with the partial notice instead of blanking the section. Only an
     * empty list becomes the sign-in state. */
    if (data.items.length > 0) return { items: data.items, status: 'partial' }
    return { items: [], status: 'signed-out' }
  }
  if (data.unreachable) return { items: data.items, status: 'unreachable' }
  return { items: data.items, status: 'ready' }
}
