import { Fragment, useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { QuietButton } from './QuietButton'
import { Text } from './Text'
import './InfiniteList.css'

export interface InfiniteListProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** All rows loaded so far, in display order. */
  items: readonly T[]
  /** Stable key per row (account + id for mail threads). */
  keyOf: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  /** False once the last page has arrived (result.next absent). */
  hasMore: boolean
  onLoadMore: () => void
  isLoadingMore?: boolean
  /** Quiet error row with a retry button; null hides it. */
  loadMoreError?: string | null
  onRetry?: () => void
  retryLabel?: string
  loadingMoreLabel?: string
  /** Shown once the end arrives while rows exist; null (default) ends quietly. */
  endLabel?: ReactNode
  /** Shown when the first page comes back with no rows and nothing is pending. */
  emptyState?: ReactNode
  label?: string
}

/* Reusable infinite-scroll primitive: an IntersectionObserver sentinel near
 * the end triggers onLoadMore; loading/end/error rows are built in so each
 * screen owns only its row component and its page query. */
export function InfiniteList<T>({
  items,
  keyOf,
  renderItem,
  hasMore,
  onLoadMore,
  isLoadingMore = false,
  loadMoreError = null,
  onRetry,
  retryLabel = 'Retry',
  loadingMoreLabel = 'Loading…',
  endLabel = null,
  emptyState = null,
  label,
  className,
  ...rest
}: InfiniteListProps<T>): React.JSX.Element {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  onLoadMoreRef.current = onLoadMore
  const guardRef = useRef({ hasMore, isLoadingMore, hasError: loadMoreError != null })
  guardRef.current = { hasMore, isLoadingMore, hasError: loadMoreError != null }

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (sentinel === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        const guard = guardRef.current
        if (guard.hasMore && !guard.isLoadingMore && !guard.hasError) {
          onLoadMoreRef.current()
        }
      },
      { rootMargin: '400px 0px' }
    )
    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [hasMore])

  return (
    <div
      {...rest}
      aria-label={label}
      className={['moki-infinite-list', className].filter(Boolean).join(' ')}
    >
      {items.map((item, index) => (
        <Fragment key={keyOf(item, index)}>{renderItem(item, index)}</Fragment>
      ))}
      {hasMore ? (
        <div ref={sentinelRef} className="moki-infinite-list-sentinel" aria-hidden="true" />
      ) : null}
      {isLoadingMore ? (
        <div className="moki-infinite-list-status" role="status">
          <Text variant="small">{loadingMoreLabel}</Text>
        </div>
      ) : null}
      {loadMoreError != null ? (
        <div className="moki-infinite-list-status" role="alert">
          <Text variant="small">{loadMoreError}</Text>
          {onRetry ? <QuietButton onClick={onRetry}>{retryLabel}</QuietButton> : null}
        </div>
      ) : null}
      {!hasMore && items.length > 0 && endLabel != null ? (
        <div className="moki-infinite-list-status">
          <Text variant="small">{endLabel}</Text>
        </div>
      ) : null}
      {!hasMore &&
      items.length === 0 &&
      !isLoadingMore &&
      loadMoreError == null &&
      emptyState != null ? (
        <div className="moki-infinite-list-status">{emptyState}</div>
      ) : null}
    </div>
  )
}
