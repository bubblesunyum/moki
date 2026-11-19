import { GlassPane, QuietState, type FigmaIconName } from '../../ui'
import { useState } from 'react'
import { useInboxThreads } from '../mail/hooks/useInboxThreads'
import { useSelectedThread } from '../mail/hooks/useSelectedThread'
import { MessagesToolbar, type MessageSource } from './MessagesToolbar'
import { ThreadList } from '../mail/ThreadList'
// Boundary: the thread pane is owned by the mok-ayu.4 worker (thread/**).
import { ThreadPane } from '../mail/thread/index'
import '../mail/InboxLayout.css'

const SOURCE_VALUES: MessageSource[] = ['all', 'text', 'email', 'slack', 'discord']

function queryParam(name: string): string | undefined {
  const raw = new URLSearchParams(window.location.search).get(name)?.trim()
  return raw === null || raw === undefined || raw === '' ? undefined : raw
}

function initialSource(): MessageSource {
  const raw = queryParam('mokiSegment')?.toLowerCase()
  if (raw === undefined) return 'email'
  const match = SOURCE_VALUES.find((source) => source === raw)
  if (match !== undefined) return match
  console.warn(`[capture] unknown MOKI_SEGMENT="${raw}", using Email`)
  return 'email'
}

function preferredThreadId(): string | undefined {
  return queryParam('mokiThread')
}

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
 * stay quiet with Coming soon until their beads land.
 *
 * Capture overrides (dev only, via ?mokiSegment= / ?mokiThread= on the
 * startup URL): an unknown segment warns and keeps Email; the preferred
 * thread id is resolved by useSelectedThread once the inbox arrives. */
export function MessagesLens(): React.JSX.Element {
  const [source, setSource] = useState<MessageSource>(initialSource)
  const [threadPreference] = useState(preferredThreadId)
  const inbox = useInboxThreads('INBOX', source === 'email')
  const { selection, select } = useSelectedThread(
    source === 'email' ? inbox.threads : undefined,
    threadPreference
  )

  return (
    <div className="moki-inbox-lens">
      <GlassPane className="moki-inbox-list" data-testid="messages-list-pane">
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
      <GlassPane className="moki-inbox-thread" data-testid="messages-thread-pane">
        <ThreadPane selection={source === 'email' ? selection : null} />
      </GlassPane>
    </div>
  )
}
