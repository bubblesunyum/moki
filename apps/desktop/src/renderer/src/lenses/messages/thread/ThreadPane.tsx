import { useEffect, useRef } from 'react'
import { useRpcQuery } from '../../../rpc/hooks'
import { QuietButton, QuietState, Text } from '../../../ui'
import type { ThreadSelection } from '../hooks/useSelectedThread'
import { EmailCard } from './EmailCard'
import './ThreadPane.css'

export interface ThreadPaneProps {
  selection: ThreadSelection | null
}

/* Read-only email thread: subject header, then one card per message, newest
 * at the bottom. The list worker owns selection state and renders this in
 * the right GlassPane. */
export function ThreadPane({ selection }: ThreadPaneProps): React.JSX.Element {
  const query = useRpcQuery('mail.getThread', selection ?? undefined, {
    enabled: selection != null
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const thread = query.data
  const selectionKey = selection == null ? '' : `${selection.account}/${selection.id}`
  const scrolledKeyRef = useRef('')

  // Scroll to the bottom only when the selected thread changes — a refetch
  // of the same thread (new reply arriving, polling) must not yank the
  // scroll position. The effect runs once the new thread's data is in.
  useEffect(() => {
    if (selectionKey === '') {
      scrolledKeyRef.current = ''
      return
    }
    if (thread == null) return
    if (scrolledKeyRef.current === selectionKey) return
    scrolledKeyRef.current = selectionKey
    const el = scrollRef.current
    if (el != null) {
      el.scrollTop = el.scrollHeight
    }
  }, [selectionKey, thread])

  if (selection == null) {
    return (
      <div className="moki-thread-empty" data-testid="thread-empty">
        <QuietState icon="mail" text="Select a conversation" label="Select a conversation" />
      </div>
    )
  }

  if (query.isPending) {
    return (
      <div
        className="moki-thread-loading"
        data-testid="thread-loading"
        aria-busy="true"
        aria-label="Loading conversation"
      >
        <div className="moki-thread-subject-skeleton" />
        <div className="moki-thread-card-skeleton" />
        <div className="moki-thread-card-skeleton" />
      </div>
    )
  }

  if (query.isError || thread == null) {
    return (
      <div className="moki-thread-error" data-testid="thread-error">
        <QuietState
          icon="mail"
          text="Couldn't load this conversation."
          label="Couldn't load this conversation"
          alert
          action={<QuietButton onClick={() => void query.refetch()}>Retry</QuietButton>}
        />
      </div>
    )
  }

  // Display order is oldest first so the newest message sits at the bottom.
  const messages = [...thread.messages].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date)
  )

  return (
    <div className="moki-thread" data-testid="thread-pane">
      <div className="moki-thread-scroll" ref={scrollRef} data-testid="thread-scroll">
        <div className="moki-thread-history">
          <div className="moki-thread-subject" data-testid="thread-subject">
            <Text variant="body" tone="muted" as="div" className="moki-thread-subject-text">
              &#8627; {thread.subject}
            </Text>
          </div>
          {messages.map((message) => (
            <EmailCard key={message.id} message={message} />
          ))}
        </div>
      </div>
    </div>
  )
}
