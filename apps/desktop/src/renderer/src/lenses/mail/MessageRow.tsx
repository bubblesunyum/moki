import type { ThreadSummary } from '../../../../../../../packages/protocol/src/index'
import { Avatar, AvatarBadge, Row } from '../../ui'
import { formatListDate } from './formatListDate'
import type { ThreadSelection } from './hooks/useSelectedThread'
import './MessageRow.css'

export interface MessageRowProps {
  thread: ThreadSummary
  selected: boolean
  onSelect: (selection: ThreadSelection) => void
}

/* One inbox row (brief §4): avatar with the amber email badge, sender name,
 * relative time, and the subject (or the snippet when the subject is empty).
 * Unread names render bolder (Lenses/Control selected) in ink, or white
 * when selected; read names and previews render muted. The selected row
 * uses the shared Selection · lit style through Row. A native button carries
 * the whole row so keyboard activation is free. Unread rows prefix the
 * accessible name with "Unread:"; the avatar dot stays decorative. */
export function MessageRow({ thread, selected, onSelect }: MessageRowProps): React.JSX.Element {
  const senderName = thread.from.name.trim() || thread.from.address
  const preview = thread.subject.trim() || thread.snippet
  /* Read state drives the tones, mirroring psymail's text-vs-textMuted:
   * unread rows render ink (white when selected), read rows render muted. */
  const tone = thread.unread ? (selected ? 'white' : 'ink') : 'muted'

  return (
    <Row
      as="button"
      className="moki-message-row"
      selected={selected}
      aria-label={thread.unread ? `Unread: ${senderName} — ${preview}` : `${senderName} — ${preview}`}
      aria-current={selected ? true : undefined}
      onClick={() => onSelect({ account: thread.account, id: thread.id })}
      leading={
        <Avatar
          name={senderName}
          size={32}
          badge={<AvatarBadge accent="amber" icon="mail" label="Email" />}
          indicator={
            thread.unread ? (
              <span className="moki-avatar-indicator" aria-hidden="true" />
            ) : undefined
          }
        />
      }
      title={senderName}
      titleVariant={thread.unread ? 'control-selected' : 'control'}
      titleTone={tone}
      meta={formatListDate(thread.date)}
      preview={preview}
      previewTone={tone}
    />
  )
}
