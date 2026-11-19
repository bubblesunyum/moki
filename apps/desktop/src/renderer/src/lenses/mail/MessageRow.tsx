import type { ThreadSummary } from '../../../../../../../packages/protocol/src/index'
import { Avatar, AvatarBadge, Row, Text } from '../../ui'
import { formatRelativeTime } from './formatRelativeTime'
import type { ThreadSelection } from './hooks/useSelectedThread'
import './MessageRow.css'

export interface MessageRowProps {
  thread: ThreadSummary
  selected: boolean
  onSelect: (selection: ThreadSelection) => void
}

/* One inbox row (brief §4): avatar with the amber email badge, sender name,
 * relative time, and the subject (or the snippet when the subject is empty).
 * Unread names render bolder (Lenses/Control selected); the selected row
 * uses the shared Selection · lit style via Row. A native button carries
 * the whole row so keyboard activation is free. */
export function MessageRow({ thread, selected, onSelect }: MessageRowProps): React.JSX.Element {
  const senderName = thread.from.name.trim() || thread.from.address
  const preview = thread.subject.trim() || thread.snippet

  return (
    <Row
      as="button"
      className="moki-message-row"
      selected={selected}
      aria-label={`${senderName} — ${preview}`}
      aria-current={selected ? true : undefined}
      onClick={() => onSelect({ account: thread.account, id: thread.id })}
      leading={
        <Avatar
          name={senderName}
          size={32}
          badge={<AvatarBadge accent="amber" icon="mail" label="Email" />}
        />
      }
      title={
        thread.unread ? (
          <Text variant="control-selected" tone={selected ? 'white' : 'ink'}>
            {senderName}
          </Text>
        ) : (
          senderName
        )
      }
      meta={formatRelativeTime(thread.date)}
      preview={preview}
    />
  )
}
