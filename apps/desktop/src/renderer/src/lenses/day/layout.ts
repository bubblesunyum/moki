/* Day lens widget-board layout: pure logic for order, spans and persistence.
 *
 * The board is a 12-column CSS grid. Order in the array IS the visual order
 * (grid auto-flow); dragging reorders the array so neighbours displace, and
 * resizing changes a widget's column span so the grid reflows around it.
 * Layout persists to localStorage under DAY_LAYOUT_STORAGE_KEY. */

export const DAY_LAYOUT_STORAGE_KEY = 'moki.day.layout'
export const DAY_LAYOUT_VERSION = 1
export const DAY_GRID_COLUMNS = 12
export const DAY_MIN_SPAN = 2
export const DAY_MAX_SPAN = DAY_GRID_COLUMNS

export interface DayWidgetPlacement {
  id: string
  /** Column span, 1..DAY_GRID_COLUMNS (clamped on the way in). */
  span: number
}

/* Storage surface we need — a subset of Storage so tests can pass a stub. */
export interface DayLayoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/* Clamp a span into the grid. Non-finite input falls back to the minimum. */
export function clampSpan(span: number): number {
  if (!Number.isFinite(span)) return DAY_MIN_SPAN
  return Math.min(DAY_MAX_SPAN, Math.max(DAY_MIN_SPAN, Math.round(span)))
}

/* Which half of a drop target the pointer is over: past the midpoint reads
 * as "after". Pure so dragover handlers and tests share the one rule. */
export function dropAfter(rectWidth: number, offsetX: number): boolean {
  return offsetX > rectWidth / 2
}

/* Move `draggedId` before (`after: false`) or after (`after: true`)
 * `targetId`. Unknown ids and no-op drops return the input unchanged so
 * dragover handlers can skip redundant state updates. */
export function moveWidget(
  placements: DayWidgetPlacement[],
  draggedId: string,
  targetId: string,
  after: boolean
): DayWidgetPlacement[] {
  if (draggedId === targetId) return placements
  const from = placements.findIndex((p) => p.id === draggedId)
  const to = placements.findIndex((p) => p.id === targetId)
  if (from === -1 || to === -1) return placements
  const next = placements.filter((p) => p.id !== draggedId)
  const targetIndex = next.findIndex((p) => p.id === targetId)
  const insertAt = after ? targetIndex + 1 : targetIndex
  next.splice(insertAt, 0, { ...placements[from] })
  /* Unchanged order (dragover fires continuously): return the input so
   * callers skip redundant state updates and persistence writes. */
  if (next.every((p, index) => p.id === placements[index].id)) return placements
  return next
}

/* Move `draggedId` to the end of the board (container background drop). */
export function moveWidgetToEnd(
  placements: DayWidgetPlacement[],
  draggedId: string
): DayWidgetPlacement[] {
  const from = placements.findIndex((p) => p.id === draggedId)
  if (from === -1 || from === placements.length - 1) return placements
  const next = placements.filter((p) => p.id !== draggedId)
  next.push({ ...placements[from] })
  return next
}

/* Resize one widget's span; neighbours reflow via grid auto-flow. */
export function resizeWidget(
  placements: DayWidgetPlacement[],
  id: string,
  span: number
): DayWidgetPlacement[] {
  const clamped = clampSpan(span)
  if (placements.find((p) => p.id === id)?.span === clamped) return placements
  return placements.map((p) => (p.id === id ? { ...p, span: clamped } : p))
}

interface StoredLayout {
  version: number
  order: Array<{ id?: unknown; span?: unknown }>
}

function isStoredLayout(value: unknown): value is StoredLayout {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.version === DAY_LAYOUT_VERSION && Array.isArray(record.order)
}

/* Load persisted order, reconciled against the registered widget ids:
 * unknown ids are dropped, duplicates collapse to the first, bad spans are
 * clamped, and newly-registered widgets append at their default span. */
export function loadDayLayout(
  storage: DayLayoutStorage | undefined,
  registeredIds: string[],
  defaultSpanFor: (id: string) => number
): DayWidgetPlacement[] {
  const defaults = registeredIds.map((id) => ({ id, span: clampSpan(defaultSpanFor(id)) }))
  let raw: string | null = null
  try {
    raw = storage?.getItem(DAY_LAYOUT_STORAGE_KEY) ?? null
  } catch {
    return defaults
  }
  if (raw === null) return defaults
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaults
  }
  if (!isStoredLayout(parsed)) return defaults
  const seen = new Set<string>()
  const restored: DayWidgetPlacement[] = []
  for (const entry of parsed.order) {
    const id = entry.id
    if (typeof id !== 'string' || !registeredIds.includes(id) || seen.has(id)) continue
    seen.add(id)
    restored.push({ id, span: clampSpan(Number(entry.span)) })
  }
  for (const fallback of defaults) {
    if (!seen.has(fallback.id)) restored.push(fallback)
  }
  return restored
}

/* Persist order. Never throws — private-mode quota errors stay silent. */
export function saveDayLayout(
  storage: DayLayoutStorage | undefined,
  placements: DayWidgetPlacement[]
): void {
  try {
    storage?.setItem(
      DAY_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: DAY_LAYOUT_VERSION,
        order: placements.map((p) => ({ id: p.id, span: p.span }))
      })
    )
  } catch {
    /* Storage unavailable or full: the board still works for the session. */
  }
}
