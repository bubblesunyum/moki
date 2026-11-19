import type { ThreadSummary } from '../../../../../../../packages/protocol/src/index'
import { Icon, InfiniteList, QuietButton, QuietState, Text } from '../../ui'
import { useAccounts } from './hooks/useAccounts'
import type { useInboxThreads } from './hooks/useInboxThreads'
import type { ThreadSelection } from './hooks/useSelectedThread'
import { MessageRow } from './MessageRow'
import './ThreadList.css'

export interface ThreadListProps {
  query: ReturnType<typeof useInboxThreads>
  selection: ThreadSelection | null
  onSelect: (selection: ThreadSelection) => void
  /* Lens title for the list copy (e.g. 'Commerce'). Absent keeps the
   * Gmail-inbox wording Messages uses. */
  title?: string
  /* Show the amber mail badge on every row. Single-source lists omit it
   * (redundant); mixed-source lists (e.g. Messages All) opt in. */
  showSourceBadge?: boolean
}

function isSelected(
  selection: ThreadSelection | null,
  thread: ThreadSummary
): boolean {
  return selection?.account === thread.account && selection?.id === thread.id
}

function LoadingSkeletons({ title }: { title?: string }): React.JSX.Element {
  return (
    <div
      className="moki-thread-list"
      role="status"
      aria-label={title === undefined ? 'Loading inbox' : `Loading ${title} inbox`}
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="moki-thread-list-skeleton" aria-hidden="true">
          <span className="moki-thread-list-skeleton-avatar" />
          <span className="moki-thread-list-skeleton-lines">
            <span className="moki-thread-list-skeleton-line moki-thread-list-skeleton-line--name" />
            <span className="moki-thread-list-skeleton-line moki-thread-list-skeleton-line--preview" />
          </span>
        </div>
      ))}
    </div>
  )
}

function FullError({ onRetry, title }: { onRetry: () => void; title?: string }): React.JSX.Element {
  const text = title === undefined ? "Couldn't load the inbox" : `Couldn't load the ${title} inbox`
  return (
    <div className="moki-thread-list">
      <QuietState
        icon="mail"
        text={text}
        label={text}
        alert
        action={<QuietButton onClick={onRetry}>Retry</QuietButton>}
      />
    </div>
  )
}

/* Email inbox list: merged Gmail INBOX rows with infinite scroll, plus the
 * quiet edge states (loading skeletons, empty, signed-out, banner). An
 * accounts.list failure never replaces already-loaded threads — it only
 * becomes the full error when there is nothing else to show. */
export function ThreadList({ query, selection, onSelect, title, showSourceBadge = false }: ThreadListProps): React.JSX.Element {
  const accountsQuery = useAccounts()
  const { threads, unreachable, authExpired } = query
  const emptyText = title === undefined ? 'Inbox is clear' : `${title} is clear`

  if (query.isPending || accountsQuery.isPending) return <LoadingSkeletons title={title} />

  const retryAll = (): void => {
    void query.refetch()
    void accountsQuery.refetch()
  }

  // Full error only when there is nothing to show; otherwise the list stays
  // up and the failure degrades to a one-line banner below.
  if (threads.length === 0 && !query.hasNextPage) {
    if (query.isError) return <FullError onRetry={retryAll} title={title} />
    if (accountsQuery.isError) return <FullError onRetry={retryAll} title={title} />
  }

  if ((accountsQuery.data?.accounts ?? []).length === 0 && !accountsQuery.isError) {
    if (accountsQuery.data?.psymailImport === 'pending') {
      return (
        <div className="moki-thread-list">
          <QuietState
            icon="messages"
            text="Waiting for access to Psymail sign-ins"
            label="Waiting for Psymail sign-ins"
          />
        </div>
      )
    }
    return (
      <div className="moki-thread-list">
        <QuietState icon="mail" text="Sign in to Gmail in Psymail" label="No Gmail accounts" />
      </div>
    )
  }

  if (threads.length === 0 && !query.hasNextPage) {
    return (
      <div className="moki-thread-list">
        <QuietState icon="mail" text={emptyText} label={emptyText} />
      </div>
    )
  }

  const bannerParts: string[] = []
  if (authExpired.length > 0) {
    bannerParts.push(`${authExpired.length} sign-in${authExpired.length === 1 ? '' : 's'} expired`)
  }
  if (unreachable.length > 0) {
    bannerParts.push(`${unreachable.length} unreachable`)
  }
  if (accountsQuery.isError) {
    bannerParts.push('account info unavailable')
  }

  return (
    <div className="moki-thread-list">
      {bannerParts.length > 0 ? (
        <div className="moki-thread-list-banner" role="note">
          <Icon name="notifications" size={16} />
          <Text variant="small">{bannerParts.join(' · ')}</Text>
        </div>
      ) : null}
      <InfiniteList
        items={threads}
        keyOf={(thread) => `${thread.account}/${thread.id}`}
        renderItem={(thread) => (
          <MessageRow thread={thread} selected={isSelected(selection, thread)} onSelect={onSelect} showEmailBadge={showSourceBadge} />
        )}
        label={title === undefined ? 'Gmail inbox' : `${title} inbox`}
        hasMore={query.hasNextPage}
        onLoadMore={() => {
          void query.fetchNextPage()
        }}
        isLoadingMore={query.isFetchingNextPage}
        loadMoreError={query.isError ? 'Couldn’t load more threads' : null}
        onRetry={() => {
          void query.fetchNextPage()
        }}
      />
    </div>
  )
}
