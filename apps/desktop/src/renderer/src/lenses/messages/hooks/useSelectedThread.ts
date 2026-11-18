import { useEffect, useState } from 'react'
import type { ThreadSummary } from '../../../../../../../../packages/protocol/src/index'

export interface ThreadSelection {
  account: string
  id: string
}

/* List-owned selection: the thread pane renders ThreadPane with this
 * selection. The first thread is selected once the inbox arrives so the
 * 2-up view opens on a thread; afterwards the user owns the selection. */
export function useSelectedThread(threads: ThreadSummary[] | undefined): {
  selection: ThreadSelection | null
  select: (selection: ThreadSelection) => void
} {
  const [selection, setSelection] = useState<ThreadSelection | null>(null)
  useEffect(() => {
    if (selection === null && threads !== undefined && threads.length > 0) {
      const first = threads[0]
      if (first !== undefined) setSelection({ account: first.account, id: first.id })
    }
  }, [selection, threads])
  return { selection, select: setSelection }
}
