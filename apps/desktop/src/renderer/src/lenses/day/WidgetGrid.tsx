import { useRef, useState } from 'react'
import { GlassPane, Icon, Text } from '../../ui'
import type { DayEvent } from './dayEvents'
import { DAY_GRID_COLUMNS, clampSpan, dropAfter } from './layout'
import { useDayLayout } from './hooks/useDayLayout'
import { DAY_WIDGETS, dayWidgetById, type DayWidgetDef } from './widgets'

const DRAG_MIME = 'application/x-moki-day-widget'

interface DropPreview {
  id: string
  after: boolean
}

/* Widget board: 12-column grid. Drag reorders live (the array order is the
 * visual order, so neighbours displace iOS-style); the corner handle scrubs
 * the column span and the grid reflows around it. Order + spans persist via
 * useDayLayout. Follows gooey pin-bar's HTML5 DnD shape (draggable +
 * setData/effectAllowed, dragover dropEffect, drop by pointer half). */
export function WidgetGrid({ events, now }: { events: DayEvent[]; now: number }): React.JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [preview, setPreview] = useState<DropPreview | null>(null)
  const { placements, move, moveToEnd, resize } = useDayLayout(
    DAY_WIDGETS.map((widget) => widget.id),
    (id) => dayWidgetById(id)?.defaultSpan ?? 6
  )

  const ordered: DayWidgetDef[] = []
  for (const placement of placements) {
    const def = dayWidgetById(placement.id)
    if (def) ordered.push(def)
  }

  function handleDragStart(e: React.DragEvent, id: string): void {
    try {
      e.dataTransfer.setData(DRAG_MIME, id)
      e.dataTransfer.effectAllowed = 'move'
    } catch {
      /* Synthetic events in tests may lack a dataTransfer. */
    }
    setDragId(id)
  }

  function handleDragOver(e: React.DragEvent, id: string): void {
    if (!dragId || dragId === id) return
    e.preventDefault()
    try {
      e.dataTransfer.dropEffect = 'move'
    } catch {
      /* No-op when dataTransfer is unavailable. */
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const offsetX = e.clientX - rect.left
    /* jsdom drops clientX on synthetic DragEvents (it arrives undefined):
     * fall back to "after" so tests still drive the reorder path. Real
     * pointers always carry a finite clientX. */
    const after = Number.isFinite(offsetX) ? dropAfter(rect.width, offsetX) : true
    setPreview({ id, after })
    move(dragId, id, after)
  }

  function endDrag(): void {
    setDragId(null)
    setPreview(null)
  }

  function handleDrop(e: React.DragEvent): void {
    if (!dragId) return
    /* Landed on a widget: dragover already placed it. Stop the event here
     * so the grid background handler doesn't also send it to the end. */
    e.stopPropagation()
    e.preventDefault()
    endDrag()
  }

  function handleGridDragOver(e: React.DragEvent): void {
    if (!dragId) return
    e.preventDefault()
  }

  function handleGridDrop(e: React.DragEvent): void {
    if (!dragId) return
    e.preventDefault()
    moveToEnd(dragId)
    endDrag()
  }

  return (
    <div
      ref={gridRef}
      className="moki-day-grid"
      data-testid="day-grid"
      onDragOver={handleGridDragOver}
      onDrop={handleGridDrop}
    >
      {ordered.map((widget) => {
        const placement = placements.find((p) => p.id === widget.id)
        const span = placement?.span ?? widget.defaultSpan
        const Widget = widget.Component
        const isDragging = dragId === widget.id
        const isPreview = preview?.id === widget.id
        return (
          <GlassPane
            key={widget.id}
            className={['moki-day-widget', isDragging ? 'is-dragging' : null, isPreview ? 'is-drop-target' : null]
              .filter(Boolean)
              .join(' ')}
            style={{ gridColumn: `span ${span}` }}
            data-testid={`day-widget-${widget.id}`}
            draggable
            onDragStart={(e) => handleDragStart(e, widget.id)}
            onDragOver={(e) => handleDragOver(e, widget.id)}
            onDrop={(e) => handleDrop(e)}
            onDragEnd={endDrag}
            aria-label={`${widget.title} widget`}
          >
            <div className="moki-day-widget-head">
              <Icon name={widget.icon} size={16} />
              <Text variant="control">{widget.title}</Text>
            </div>
            <Widget events={events} now={now} />
            <ResizeHandle
              label={`Resize ${widget.title}`}
              span={span}
              gridWidth={() => gridRef.current?.getBoundingClientRect().width ?? 0}
              onResize={(next) => resize(widget.id, next)}
            />
          </GlassPane>
        )
      })}
    </div>
  )
}

function ResizeHandle({
  label,
  span,
  gridWidth,
  onResize
}: {
  label: string
  span: number
  gridWidth: () => number
  onResize: (span: number) => void
}): React.JSX.Element {
  const drag = useRef<{ startX: number; startSpan: number } | null>(null)

  function columnWidth(): number {
    const width = gridWidth()
    return width > 0 ? width / DAY_GRID_COLUMNS : 0
  }

  return (
    <div
      className="moki-day-widget-resize"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={2}
      aria-valuemax={DAY_GRID_COLUMNS}
      aria-valuenow={span}
      /* The handle sits inside a draggable pane: suppress the native drag
       * so a mouse resize doesn't also displace the board. The keyboard
       * path below is unaffected. */
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        drag.current = { startX: e.clientX, startSpan: span };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={(e) => {
        const active = drag.current
        if (!active) return
        const col = columnWidth()
        if (col === 0) return
        onResize(active.startSpan + Math.round((e.clientX - active.startX) / col))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          onResize(clampSpan(span - 1))
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          onResize(clampSpan(span + 1))
        }
      }}
    />
  )
}
