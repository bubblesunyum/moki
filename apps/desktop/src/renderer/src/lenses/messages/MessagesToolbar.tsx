import { IconButton, SegmentGroup, type SegmentOption } from '../../ui'
import './MessagesToolbar.css'

export type MessageSource = 'all' | 'text' | 'email' | 'slack' | 'discord'

/* Source order, icons and accents from the brief (§4 toolbar). */
const SOURCE_OPTIONS: SegmentOption[] = [
  { value: 'all', icon: 'infinity', label: 'All', accent: 'var(--moki-accent-cyan)' },
  { value: 'text', icon: 'messages', label: 'Text', accent: 'var(--moki-accent-mint)' },
  { value: 'email', icon: 'mail', label: 'Email', accent: 'var(--moki-accent-amber)' },
  { value: 'slack', icon: 'hash', label: 'Slack', accent: 'var(--moki-accent-violet)' },
  { value: 'discord', icon: 'headset', label: 'Discord', accent: 'var(--moki-accent-coral)' }
]

export interface MessagesToolbarProps {
  source: MessageSource
  onChange: (source: MessageSource) => void
}

/* Sources segmented control (Email is the parent-owned default) plus the
 * search button, inert (aria-disabled) until search lands. */
export function MessagesToolbar({ source, onChange }: MessagesToolbarProps): React.JSX.Element {
  return (
    <div className="moki-messages-toolbar">
      <SegmentGroup
        label="Message source"
        value={source}
        options={SOURCE_OPTIONS}
        onChange={(value) => onChange(value as MessageSource)}
      />
      <IconButton
        icon="search"
        label="Search messages"
        aria-disabled="true"
        className="moki-messages-toolbar-search"
      />
    </div>
  )
}
