import type { ComponentType } from 'react'
import type { FigmaIconName } from '../../ui'
import type { DayEvent } from './dayEvents'
import { UpNextWidget } from './widgets/UpNextWidget'
import { FocusWidget } from './widgets/FocusWidget'

/* Widget registry: every board tile is an entry here with a default span
 * (12-column grid). Widgets receive the day's events + now so they can stay
 * live without their own bridge calls. */
export interface DayWidgetProps {
  events: DayEvent[]
  now: number
}

export interface DayWidgetDef {
  id: string
  title: string
  icon: FigmaIconName
  defaultSpan: number
  Component: ComponentType<DayWidgetProps>
}

export const DAY_WIDGETS: DayWidgetDef[] = [
  { id: 'up-next', title: 'Up next', icon: 'calendar', defaultSpan: 7, Component: UpNextWidget },
  { id: 'focus', title: 'Focus', icon: 'tasks', defaultSpan: 5, Component: FocusWidget }
]

export function dayWidgetById(id: string): DayWidgetDef | undefined {
  return DAY_WIDGETS.find((widget) => widget.id === id)
}
