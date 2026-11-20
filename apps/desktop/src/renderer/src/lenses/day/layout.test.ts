import { describe, expect, it } from 'vitest'
import {
  DAY_GRID_COLUMNS,
  DAY_LAYOUT_STORAGE_KEY,
  DAY_LAYOUT_VERSION,
  DAY_MAX_SPAN,
  DAY_MIN_SPAN,
  clampSpan,
  dropAfter,
  loadDayLayout,
  moveWidget,
  moveWidgetToEnd,
  resizeWidget,
  saveDayLayout,
  type DayLayoutStorage,
  type DayWidgetPlacement
} from './layout'

function placements(ids: string[]): DayWidgetPlacement[] {
  return ids.map((id, index) => ({ id, span: 4 + index }))
}

function memoryStorage(initial?: Record<string, string>): DayLayoutStorage & { data: Record<string, string> } {
  const data: Record<string, string> = { ...(initial ?? {}) }
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    }
  }
}

const IDS = ['alpha', 'beta']
const spanFor = (id: string): number => (id === 'alpha' ? 7 : 5)

describe('clampSpan', () => {
  it('rounds and clamps into the grid', () => {
    expect(clampSpan(6.7)).toBe(7)
    expect(clampSpan(0)).toBe(DAY_MIN_SPAN)
    expect(clampSpan(99)).toBe(DAY_MAX_SPAN)
    expect(clampSpan(Number.NaN)).toBe(DAY_MIN_SPAN)
  })
})

describe('dropAfter', () => {
  it('splits at the midpoint', () => {
    expect(dropAfter(200, 49)).toBe(false)
    expect(dropAfter(200, 151)).toBe(true)
    // Exactly on the half reads as "before".
    expect(dropAfter(200, 100)).toBe(false)
  })

  it('treats zero-width rects by pointer offset', () => {
    expect(dropAfter(0, 0)).toBe(false)
    expect(dropAfter(0, 1)).toBe(true)
  })
})

describe('moveWidget', () => {
  it('moves the dragged widget before the target', () => {
    const next = moveWidget(placements(['a', 'b', 'c']), 'c', 'a', false)
    expect(next.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('moves the dragged widget after the target', () => {
    const next = moveWidget(placements(['a', 'b', 'c']), 'a', 'c', true)
    expect(next.map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('keeps spans attached to their widgets', () => {
    const next = moveWidget(placements(['a', 'b']), 'a', 'b', true)
    expect(next).toEqual([
      { id: 'b', span: 5 },
      { id: 'a', span: 4 }
    ])
  })

  it('returns the input unchanged for no-ops', () => {
    const prev = placements(['a', 'b'])
    expect(moveWidget(prev, 'a', 'a', true)).toBe(prev)
    expect(moveWidget(prev, 'missing', 'a', false)).toBe(prev)
    expect(moveWidget(prev, 'a', 'missing', false)).toBe(prev)
    // Re-dropping where the widget already sits keeps the identity too.
    expect(moveWidget(prev, 'a', 'b', false)).toBe(prev)
    expect(moveWidget(prev, 'b', 'a', true)).toBe(prev)
  })
})

describe('moveWidgetToEnd', () => {
  it('sends the widget to the end', () => {
    expect(moveWidgetToEnd(placements(['a', 'b', 'c']), 'a').map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('is a no-op at the end or for unknown ids', () => {
    const prev = placements(['a', 'b'])
    expect(moveWidgetToEnd(prev, 'b')).toBe(prev)
    expect(moveWidgetToEnd(prev, 'missing')).toBe(prev)
  })
})

describe('resizeWidget', () => {
  it('resizes one widget and clamps the span', () => {
    const next = resizeWidget(placements(['a', 'b']), 'a', 200)
    expect(next).toEqual([
      { id: 'a', span: DAY_GRID_COLUMNS },
      { id: 'b', span: 5 }
    ])
  })

  it('returns the input unchanged when the span does not change', () => {
    const prev = placements(['a', 'b'])
    expect(resizeWidget(prev, 'a', 4)).toBe(prev)
  })
})

describe('loadDayLayout', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadDayLayout(memoryStorage(), IDS, spanFor)).toEqual([
      { id: 'alpha', span: 7 },
      { id: 'beta', span: 5 }
    ])
  })

  it('restores a stored order with spans', () => {
    const storage = memoryStorage({
      [DAY_LAYOUT_STORAGE_KEY]: JSON.stringify({
        version: DAY_LAYOUT_VERSION,
        order: [
          { id: 'beta', span: 8 },
          { id: 'alpha', span: 4 }
        ]
      })
    })
    expect(loadDayLayout(storage, IDS, spanFor)).toEqual([
      { id: 'beta', span: 8 },
      { id: 'alpha', span: 4 }
    ])
  })

  it('falls back to defaults on corrupt JSON or a version mismatch', () => {
    const corrupt = memoryStorage({ [DAY_LAYOUT_STORAGE_KEY]: 'not json' })
    expect(loadDayLayout(corrupt, IDS, spanFor)).toEqual([
      { id: 'alpha', span: 7 },
      { id: 'beta', span: 5 }
    ])
    const future = memoryStorage({
      [DAY_LAYOUT_STORAGE_KEY]: JSON.stringify({ version: 999, order: [] })
    })
    expect(loadDayLayout(future, IDS, spanFor)).toEqual([
      { id: 'alpha', span: 7 },
      { id: 'beta', span: 5 }
    ])
  })

  it('drops unknown ids, dedupes, clamps spans and appends new widgets', () => {
    const storage = memoryStorage({
      [DAY_LAYOUT_STORAGE_KEY]: JSON.stringify({
        version: DAY_LAYOUT_VERSION,
        order: [
          { id: 'beta', span: 40 },
          { id: 'gone', span: 6 },
          { id: 'beta', span: 3 }
        ]
      })
    })
    expect(loadDayLayout(storage, IDS, spanFor)).toEqual([
      { id: 'beta', span: DAY_GRID_COLUMNS },
      { id: 'alpha', span: 7 }
    ])
  })

  it('returns defaults when storage throws', () => {
    const broken: DayLayoutStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {}
    }
    expect(loadDayLayout(broken, IDS, spanFor)).toEqual([
      { id: 'alpha', span: 7 },
      { id: 'beta', span: 5 }
    ])
  })
})

describe('saveDayLayout', () => {
  it('writes a versioned payload', () => {
    const storage = memoryStorage()
    saveDayLayout(storage, [
      { id: 'beta', span: 8 },
      { id: 'alpha', span: 4 }
    ])
    expect(JSON.parse(storage.data[DAY_LAYOUT_STORAGE_KEY])).toEqual({
      version: DAY_LAYOUT_VERSION,
      order: [
        { id: 'beta', span: 8 },
        { id: 'alpha', span: 4 }
      ]
    })
  })

  it('round-trips through loadDayLayout', () => {
    const storage = memoryStorage()
    const order: DayWidgetPlacement[] = [
      { id: 'beta', span: 8 },
      { id: 'alpha', span: 4 }
    ]
    saveDayLayout(storage, order)
    expect(loadDayLayout(storage, IDS, spanFor)).toEqual(order)
  })

  it('swallows quota errors', () => {
    const full: DayLayoutStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      }
    }
    expect(() => saveDayLayout(full, placements(IDS))).not.toThrow()
  })
})
