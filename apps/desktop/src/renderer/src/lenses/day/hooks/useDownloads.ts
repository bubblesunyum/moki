import { useCallback, useEffect, useRef, useState } from 'react'
import type { DayDownloadsEntry } from '../../../../../../../../packages/protocol/src/index'
import { callDay } from '../../../rpc/bridge'

/* ~/Downloads over `day:call`: refetches when `showHidden` flips. Open and
 * reveal go back through the main gate (Downloads-only validation). Without
 * a bridge the list stays empty — the shelf section still renders. */
export function useDownloads(showHidden: boolean): {
  entries: DayDownloadsEntry[]
  openPath: (path: string) => void
  revealPath: (path: string) => void
} {
  const [entries, setEntries] = useState<DayDownloadsEntry[]>([])
  /* Generation counter: a slow resolution from a previous `showHidden`
   * value must not overwrite the current one. */
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    const mine = generation.current
    let cancelled = false
    callDay('day.downloadsList', { showHidden })
      .then((res) => {
        if (cancelled || mine !== generation.current) return
        setEntries(Array.isArray(res.entries) ? res.entries : [])
      })
      .catch(() => {
        if (cancelled || mine !== generation.current) return
        setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [showHidden])

  const openPath = useCallback((path: string) => {
    callDay('day.openPath', { path }).catch(() => undefined)
  }, [])

  const revealPath = useCallback((path: string) => {
    callDay('day.revealPath', { path }).catch(() => undefined)
  }, [])

  return { entries, openPath, revealPath }
}
