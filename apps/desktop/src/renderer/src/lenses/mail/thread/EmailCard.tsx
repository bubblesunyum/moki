import type { MailMessage } from '../../../../../../../../packages/protocol/src/index'
import { Text } from '../../../ui'
import { EmailBody } from './EmailBody'
import { formatListDate } from '../formatListDate'

export interface EmailCardProps {
  message: MailMessage
}

/* One message: sender + relative date above (Lenses/Small faint), then the
 * full-width quiet-fill card. Own messages are full width too, marked 'You'. */
export function EmailCard({ message }: EmailCardProps): React.JSX.Element {
  const sender = message.isFromMe
    ? 'You'
    : message.from.name.trim() || message.from.address
  const date = formatListDate(message.date)
  return (
    <article className="moki-email" data-testid={`email-card-${message.id}`}>
      <div className="moki-email-meta">
        <Text variant="small" className="moki-email-sender">
          {sender}
        </Text>
        {date !== '' ? <Text variant="small">{date}</Text> : null}
      </div>
      <div className="moki-email-card lens-body">
        <EmailBody html={message.html} text={message.text} />
      </div>
    </article>
  )
}
