import type { ReactNode } from 'react'
import './QuietState.css'
import { Icon, type FigmaIconName } from './Icon'
import { Text } from './Text'

export interface QuietStateProps {
  icon: FigmaIconName
  text: ReactNode
  /** Accessible name for the status region. */
  label: string
  /** Optional action below the line, e.g. a QuietButton retry. */
  action?: ReactNode
  /** Render as role="alert" for errors instead of role="status". */
  alert?: boolean
}

/* Quiet state: an icon plus one line, never a paragraph (spec "States").
 * Shared by the inbox list, the thread pane and the lens coming-soon slots. */
export function QuietState({
  icon,
  text,
  label,
  action,
  alert = false
}: QuietStateProps): React.JSX.Element {
  return (
    <div className="moki-quiet-state" role={alert ? 'alert' : 'status'} aria-label={label}>
      <Icon name={icon} size={16} />
      <Text variant="text">{text}</Text>
      {action}
    </div>
  )
}
