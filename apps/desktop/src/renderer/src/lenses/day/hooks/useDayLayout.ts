import { useEffect, useState } from 'react'
import {
  loadDayLayout,
  moveWidget,
  moveWidgetToEnd,
  resizeWidget,
  saveDayLayout,
  type DayWidgetPlacement
} from '../layout'

function storageOf(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/* Board state for the Day widget grid: persisted order + spans, reconciled
 * against the registered widget ids. Persists on every change. */
export function useDayLayout(registeredIds: string[], defaultSpanFor: (id: string) => number) {
  const [placements, setPlacements] = useState<DayWidgetPlacement[]>(() =>
    loadDayLayout(storageOf(), registeredIds, defaultSpanFor)
  )

  useEffect(() => {
    saveDayLayout(storageOf(), placements)
  }, [placements])

  return {
    placements,
    move: (draggedId: string, targetId: string, after: boolean) =>
      setPlacements((prev) => moveWidget(prev, draggedId, targetId, after)),
    moveToEnd: (draggedId: string) => setPlacements((prev) => moveWidgetToEnd(prev, draggedId)),
    resize: (id: string, span: number) => setPlacements((prev) => resizeWidget(prev, id, span))
  }
}
