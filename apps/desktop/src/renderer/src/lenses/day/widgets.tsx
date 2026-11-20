import type { ComponentType } from 'react'
import type { FigmaIconName } from '../../ui'
import type { DayEvent } from './dayEvents'
import { ClipboardWidget } from './widgets/ClipboardWidget'
import { FilesWidget } from './widgets/FilesWidget'
import { FocusWidget } from './widgets/FocusWidget'
import { SystemToolsWidget } from './widgets/SystemToolsWidget'
import { UsageWidget } from './widgets/UsageWidget'
import { WebViewWidget } from './widgets/WebViewWidget'

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
  { id: 'focus', title: 'Focus', icon: 'tasks', defaultSpan: 12, Component: FocusWidget },
  { id: 'clipboard', title: 'Clipboard', icon: 'notes', defaultSpan: 6, Component: ClipboardWidget },
  { id: 'files', title: 'Files', icon: 'files', defaultSpan: 6, Component: FilesWidget },
  { id: 'usage', title: 'Usage', icon: 'infinity', defaultSpan: 6, Component: UsageWidget },
  { id: 'system', title: 'System', icon: 'code', defaultSpan: 6, Component: SystemToolsWidget },
  { id: 'web', title: 'Web', icon: 'globe', defaultSpan: 6, Component: WebViewWidget }
]

export function dayWidgetById(id: string): DayWidgetDef | undefined {
  return DAY_WIDGETS.find((widget) => widget.id === id)
}
