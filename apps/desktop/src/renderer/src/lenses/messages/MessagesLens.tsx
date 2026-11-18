import { GlassPane, QuietState, type FigmaIconName } from '../../ui'
import { useState } from 'react'
import { useInboxThreads } from './hooks/useInboxThreads'
import { useSelectedThread } from './hooks/useSelectedThread'
import { MessagesToolbar, type MessageSource } from './MessagesToolbar'
import { ThreadList } from './ThreadList'
// Boundary: the thread pane is owned by the mok-ayu.4 worker (thread/**).
import { ThreadPane } from './thread/index'
import './MessagesLens.css'

const COMING_SOON_ICON: Record<Exclude<MessageSource, 'email'>, FigmaIconName> = {
  all: 'infinity',
  text: 'messages',
  slack: 'hash',
  discord: 'headset'
}

const COMING_SOON_LABEL: Record<Exclude<MessageSource, 'email'>, string> = {
  all: 'All sources',
  text: 'Text',
  slack: 'Slack',
  discord: 'Discord'
}

/* Messages lens: source toolbar + inbox list (377px) beside the thread pane.
 * Email (merged Gmail INBOX) is the only live source; the other segments
 * stay quiet with Coming soon until their beads land. */
export function MessagesLens(): React.JSX.Element {
  const [source, setSource] = useState<MessageSource>('email')
  const inbox = useInboxThreads(source === 'email')
  const { selection, select } = useSelectedThread(source === 'email' ? inbox.threads : undefined)

  return (
    <div className="moki-messages-lens">
      <GlassPane className="moki-messages-list" data-testid="messages-list-pane">
        <MessagesToolbar source={source} onChange={setSource} />
        {source === 'email' ? (
          <ThreadList query={inbox} selection={selection} onSelect={select} />
        ) : (
          <QuietState
            icon={COMING_SOON_ICON[source]}
            text="Coming soon"
            label={`${COMING_SOON_LABEL[source]} is coming soon`}
          />
        )}
      </GlassPane>
      <GlassPane className="moki-messages-thread" data-testid="messages-thread-pane">
        <ThreadPane selection={source === 'email' ? selection : null} />
      </GlassPane>
    </div>
  )
}
