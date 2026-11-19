import type { ThreadSummary } from '../../../../../../../packages/protocol/src/index'
import { Pin } from 'lucide-react'
import { Avatar, AvatarBadge, Row, Text } from '../../ui'
import { formatListDate } from './formatListDate'
import { useSenderPhoto } from './useSenderPhoto'
import type { ThreadSelection } from './hooks/useSelectedThread'
import './MessageRow.css'

export interface MessageRowProps {
  thread: ThreadSummary
  selected: boolean
  onSelect: (selection: ThreadSelection) => void
  /* Amber mail badge on the avatar. The row only knows the email badge,
   * so the prop is email-specific; ThreadList's mixed-vs-single flag maps
   * onto it until threads carry their own source. */
  showEmailBadge?: boolean
}

/* One inbox row (brief §4): avatar (amber email badge only when asked
 * via showEmailBadge), sender name,
 * relative time, and the subject (or the snippet when the subject is empty).
 * Unread names render bolder (Lenses/Control selected) in ink, or white
 * when selected; read names and previews render muted. The selected row
 * uses the shared Selection · lit style through Row. A native button carries
 * the whole row so keyboard activation is free. Unread rows prefix the
 * accessible name with "Unread:"; pinned rows suffix it with "(pinned)" —
 * both dots stay decorative. Multi-message threads show a count pill after
 * the sender (psymail's threadCount capsule); pinned threads show a pin
 * before the date, rotated -35° like psymail's `PinButton.pinnedAngle`. The
 * avatar resolves the sender's photo (Gravatar portrait, else brand logo)
 * and falls back to the monogram while probing or on a miss. */
export function MessageRow({ thread, selected, onSelect, showEmailBadge = false }: MessageRowProps): React.JSX.Element {
  const senderName = thread.from.name.trim() || thread.from.address
  const preview = thread.subject.trim() || thread.snippet
  /* Read state drives the tones, mirroring psymail's text-vs-textMuted:
   * unread rows render ink (white when selected), read rows render muted. */
  const tone = thread.unread ? (selected ? 'white' : 'ink') : 'muted'
  const photo = useSenderPhoto(thread.from.address)

  const accessibleName = `${thread.unread ? 'Unread: ' : ''}${senderName} — ${preview}${thread.pinned ? ' (pinned)' : ''}`

  return (
    <Row
      as="button"
      className="moki-message-row"
      selected={selected}
      aria-label={accessibleName}
      aria-current={selected ? true : undefined}
      onClick={() => onSelect({ account: thread.account, id: thread.id })}
      leading={
        <Avatar
          name={senderName}
          size={32}
          photo={photo}
          badge={showEmailBadge ? <AvatarBadge accent="amber" icon="mail" label="Email" /> : undefined}
          indicator={
            thread.unread ? (
              <span className="moki-avatar-indicator" aria-hidden="true" />
            ) : undefined
          }
        />
      }
      title={
        <>
          {senderName}
          {thread.messageCount > 1 ? (
            <Text as="span" variant="small" className="moki-message-row-count">
              {thread.messageCount}
            </Text>
          ) : null}
        </>
      }
      titleVariant={thread.unread ? 'control-selected' : 'control'}
      titleTone={tone}
      meta={
        <>
          {thread.pinned ? (
            <Pin
              size={12}
              fill="currentColor"
              aria-hidden="true"
              className="moki-message-row-pin"
            />
          ) : null}
          {formatListDate(thread.date)}
        </>
      }
      preview={preview}
      previewTone={tone}
    />
  )
}
