import { useEffect, useRef, useState } from 'react'
import type { ThreadSummary } from '../../../../../../../../packages/protocol/src/index'

export interface ThreadSelection {
  account: string
  id: string
}

/* List-owned selection: the thread pane renders ThreadPane with this
 * selection. The first thread is selected once the inbox arrives so the
 * 2-up view opens on a thread; afterwards the user owns the selection.
 *
 * Capture override (dev only, via ?mokiThread= on the startup URL): when
 * preferredId names a loaded thread it wins — including over an earlier
 * first-row fallback as later pages arrive. An id with no match keeps
 * today's first-row default (warn once) so the pane is never blank. */
export function useSelectedThread(
  threads: ThreadSummary[] | undefined,
  preferredId?: string
): {
  selection: ThreadSelection | null
  select: (selection: ThreadSelection | null) => void
} {
  const [selection, setSelection] = useState<ThreadSelection | null>(null)
  const warned = useRef(false)
  useEffect(() => {
    if (threads === undefined || threads.length === 0) return
    if (preferredId !== undefined) {
      const match = threads.find((thread) => thread.id === preferredId)
      if (match !== undefined) {
        if (selection?.account !== match.account || selection?.id !== match.id) {
          setSelection({ account: match.account, id: match.id })
        }
        return
      }
      if (selection === null) {
        const first = threads[0]
        if (first !== undefined) {
          if (!warned.current) {
            warned.current = true
            console.warn(`[capture] unknown MOKI_THREAD="${preferredId}", using first thread`)
          }
          setSelection({ account: first.account, id: first.id })
        }
      }
      return
    }
    if (selection === null) {
      const first = threads[0]
      if (first !== undefined) setSelection({ account: first.account, id: first.id })
    }
  }, [selection, threads, preferredId])
  return { selection, select: setSelection }
}
