import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InfiniteList } from './InfiniteList'

type Entry = { isIntersecting: boolean }

let seen: Array<(entries: Entry[]) => void> = []

beforeEach(() => {
  seen = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      callback: (entries: Entry[]) => void
      constructor(callback: (entries: Entry[]) => void) {
        this.callback = callback
        seen.push(callback)
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function intersect(): void {
  act(() => {
    for (const callback of seen) callback([{ isIntersecting: true }])
  })
}

function renderList(props?: {
  hasMore?: boolean
  isLoadingMore?: boolean
  loadMoreError?: string | null
}): { onLoadMore: ReturnType<typeof vi.fn>; onRetry: ReturnType<typeof vi.fn> } {
  const onLoadMore = vi.fn()
  const onRetry = vi.fn()
  render(
    <InfiniteList
      items={['a', 'b']}
      keyOf={(item) => item}
      renderItem={(item) => <div>{`row ${item}`}</div>}
      label="Test list"
      hasMore={props?.hasMore ?? true}
      onLoadMore={onLoadMore}
      isLoadingMore={props?.isLoadingMore}
      loadMoreError={props?.loadMoreError}
      onRetry={onRetry}
    />
  )
  return { onLoadMore, onRetry }
}

describe('InfiniteList', () => {
  it('renders every row', () => {
    renderList()
    expect(screen.getByText('row a')).toBeDefined()
    expect(screen.getByText('row b')).toBeDefined()
  })

  it('loads more when the sentinel scrolls near', () => {
    const { onLoadMore } = renderList()
    intersect()
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('renders no sentinel once the end arrives', () => {
    const { onLoadMore } = renderList({ hasMore: false })
    expect(seen.length).toBe(0)
    expect(document.querySelector('.moki-infinite-list-sentinel')).toBeNull()
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('does not reload while a page is already loading', () => {
    const { onLoadMore } = renderList({ isLoadingMore: true })
    intersect()
    expect(onLoadMore).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeDefined()
  })

  it('holds fire while a load error is showing, then retries', () => {
    const { onLoadMore, onRetry } = renderList({ loadMoreError: 'Could not load more' })
    intersect()
    expect(onLoadMore).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows the end label and the empty state', () => {
    cleanup()
    render(
      <InfiniteList
        items={['a']}
        keyOf={(item) => item}
        renderItem={(item) => <div>{`row ${item}`}</div>}
        hasMore={false}
        onLoadMore={() => {}}
        endLabel="You are caught up"
      />
    )
    expect(screen.getByText('You are caught up')).toBeDefined()

    cleanup()
    render(
      <InfiniteList
        items={[]}
        keyOf={(item: string) => item}
        renderItem={(item: string) => <div>{`row ${item}`}</div>}
        hasMore={false}
        onLoadMore={() => {}}
        emptyState={<div>Nothing here yet</div>}
      />
    )
    expect(screen.getByText('Nothing here yet')).toBeDefined()
  })
})
