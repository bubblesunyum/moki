import type {
  AccountsListResult,
  MailListThreadsResult,
  ThreadDetail,
  ThreadSummary
} from '../../../../../../../packages/protocol/src/index'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RpcProvider } from '../../rpc/provider'
import { BundleLens } from './BundleLens'
import { CommerceLens } from '../commerce/CommerceLens'
import { FeedLens } from '../feed/FeedLens'
import { NotificationsLens } from '../notifications/NotificationsLens'
import { lensById } from '../registry'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type Entry = { isIntersecting: boolean }

function stubIntersectionObserver(): void {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(_callback: (entries: Entry[]) => void) {}
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  )
}

function thread(id: string, unread = false): ThreadSummary {
  return {
    id,
    account: 'bubbles@example.com',
    from: { name: `Sender ${id}`, address: `${id}@example.com` },
    subject: `Subject ${id}`,
    snippet: `Snippet ${id}`,
    date: new Date(Date.now() - 30 * 60_000).toISOString(),
    unread,
    messageCount: 1,
    pinned: false,
    labelIds: ['psymail/commerce']
  }
}

function threadDetail(summary: ThreadSummary): ThreadDetail {
  return {
    id: summary.id,
    account: summary.account,
    subject: summary.subject,
    messages: [
      {
        id: 'm1',
        from: summary.from,
        to: [],
        cc: [],
        date: summary.date,
        text: summary.snippet,
        isFromMe: false
      }
    ]
  }
}

const seenLabels: unknown[] = []

function mockBridge(threads: ThreadSummary[]): void {
  seenLabels.length = 0
  const detailById = new Map(threads.map((t) => [`${t.account}/${t.id}`, threadDetail(t)]))
  Object.defineProperty(window, 'moki', {
    value: {
      call: (method: string, params?: { label?: unknown; cursor?: unknown }) => {
        if (method === 'accounts.list') {
          const result: AccountsListResult = {
            accounts: [{ address: 'bubbles@example.com', name: 'Bubbles', status: 'ok' }],
            psymailImport: 'done'
          }
          return Promise.resolve(result)
        }
        if (method === 'mail.listThreads') {
          seenLabels.push(params?.label)
          const result: MailListThreadsResult = { threads, unreachable: [], authExpired: [] }
          return Promise.resolve(result)
        }
        if (method === 'mail.getThread') {
          const key = `${(params as { account: string; id: string }).account}/${(params as { account: string; id: string }).id}`
          return Promise.resolve(detailById.get(key) ?? { id: 'x', account: 'y', subject: '', messages: [] })
        }
        return Promise.reject(new Error(`unexpected method ${method}`))
      },
      on: () => () => {},
      openExternal: () => Promise.resolve()
    },
    configurable: true
  })
}

function renderLens(label: string, title: string, lensId: string): void {
  render(
    <RpcProvider>
      <BundleLens label={label} title={title} lensId={lensId} />
    </RpcProvider>
  )
}

/* Cursor-paged bridge: page N+1 arrives only after fetchNextPage, like the
 * helper's per-account cursors. The last page carries no `next`. */
function mockPagedBridge(pages: ThreadSummary[][]): void {
  const detailById = new Map(pages.flat().map((t) => [`${t.account}/${t.id}`, threadDetail(t)]))
  Object.defineProperty(window, 'moki', {
    value: {
      call: (method: string, params?: { label?: unknown; cursor?: unknown }) => {
        if (method === 'accounts.list') {
          const result: AccountsListResult = {
            accounts: [{ address: 'bubbles@example.com', name: 'Bubbles', status: 'ok' }],
            psymailImport: 'done'
          }
          return Promise.resolve(result)
        }
        if (method === 'mail.listThreads') {
          seenLabels.push(params?.label)
          const index = params?.cursor === undefined ? 0 : 1
          const threads = pages[index] ?? []
          const result: MailListThreadsResult = {
            threads,
            unreachable: [],
            authExpired: [],
            ...(index + 1 < pages.length
              ? { next: { 'bubbles@example.com': String(index + 1) } }
              : {})
          }
          return Promise.resolve(result)
        }
        if (method === 'mail.getThread') {
          const key = `${(params as { account: string; id: string }).account}/${(params as { account: string; id: string }).id}`
          return Promise.resolve(detailById.get(key) ?? { id: 'x', account: 'y', subject: '', messages: [] })
        }
        return Promise.reject(new Error(`unexpected method ${method}`))
      },
      on: () => () => {},
      openExternal: () => Promise.resolve()
    },
    configurable: true
  })
}

/* The pane prefixes the subject ('↳ Subject t1'), so wait on the subject
 * node's text instead of an exact-text query. */
async function expectPaneSubject(pane: HTMLElement, subject: string): Promise<void> {
  await waitFor(() => {
    expect(within(pane).getByTestId('thread-subject').textContent).toContain(subject)
  })
}

describe('BundleLens', () => {
  beforeEach(() => {
    stubIntersectionObserver()
  })

  it.each([
    { Component: CommerceLens, lensId: 'commerce', label: 'psymail/commerce', title: 'Commerce' },
    { Component: NotificationsLens, lensId: 'notifications', label: 'psymail/notifications', title: 'Notifications' },
    { Component: FeedLens, lensId: 'feed', label: 'psymail/feed', title: 'Feed' }
  ])('$title requests its own label', async ({ Component, label }) => {
    mockBridge([thread('t1')])
    render(
      <RpcProvider>
        <Component />
      </RpcProvider>
    )
    expect(await screen.findByText('Subject t1')).toBeDefined()
    expect(seenLabels).toContain(label)
  })

  it('shows All/Unread as text tabs that filter client-side on unread', async () => {
    mockBridge([thread('t1', true), thread('t2', false)])
    renderLens('psymail/commerce', 'Commerce', 'commerce')

    expect(await screen.findByText('Subject t1')).toBeDefined()
    expect(screen.getByText('Subject t2')).toBeDefined()

    const group = screen.getByRole('radiogroup', { name: 'Commerce filter' })
    expect(group).toBeDefined()
    // Text tabs render their labels, not icons.
    expect(screen.getByRole('radio', { name: 'All' }).textContent).toBe('All')
    expect(screen.getByRole('radio', { name: 'Unread' }).textContent).toBe('Unread')

    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }))
    expect(screen.getByText('Subject t1')).toBeDefined()
    expect(screen.queryByText('Subject t2')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: 'All' }))
    expect(screen.getByText('Subject t2')).toBeDefined()
  })

  it('reuses the list empty state when nothing is unread', async () => {
    mockBridge([thread('t1', false)])
    renderLens('psymail/feed', 'Feed', 'feed')

    expect(await screen.findByText('Subject t1')).toBeDefined()
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }))
    expect(await screen.findByText('Feed is clear')).toBeDefined()
  })

  it('names the list for the lens title', async () => {
    mockBridge([thread('t1', true)])
    renderLens('psymail/commerce', 'Commerce', 'commerce')

    expect(await screen.findByText('Subject t1')).toBeDefined()
    expect(document.querySelector('.moki-infinite-list')?.getAttribute('aria-label')).toBe(
      'Commerce inbox'
    )
  })

  it('re-anchors a hidden selection to the first unread thread', async () => {
    mockBridge([thread('t1', true), thread('t2', false)])
    renderLens('psymail/commerce', 'Commerce', 'commerce')
    const pane = screen.getByTestId('commerce-thread-pane')

    // Select the read thread on the All tab; the pane follows it.
    expect(await screen.findByText('Subject t2')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Sender t2/ }))
    await expectPaneSubject(pane, 'Subject t2')

    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }))

    // The filtered-out selection re-anchors: highlight and pane both move on.
    await expectPaneSubject(pane, 'Subject t1')
    expect(screen.queryByText('Subject t2')).toBeNull()
    expect(screen.getByRole('button', { name: /Sender t1/ }).classList.contains('selected-lit')).toBe(
      true
    )
  })

  it('clears the pane when the filter leaves nothing', async () => {
    mockBridge([thread('t1', false)])
    renderLens('psymail/commerce', 'Commerce', 'commerce')

    expect(await screen.findByText('Subject t1')).toBeDefined()
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }))

    expect(await screen.findByText('Commerce is clear')).toBeDefined()
    expect(screen.getByTestId('thread-empty')).toBeDefined()
  })

  it.each([
    {
      name: 'finds unread mail on later pages',
      pages: [[thread('t1', false)], [thread('t2', true)]],
      row: 'Subject t2'
    },
    {
      name: 'reads all-read across pages as clear',
      pages: [[thread('t1', false)], [thread('t2', false)]],
      row: 'Commerce is clear'
    }
  ])('unread tab advances paging: $name', async ({ pages, row }) => {
    mockPagedBridge(pages)
    renderLens('psymail/commerce', 'Commerce', 'commerce')
    const pane = screen.getByTestId('commerce-thread-pane')

    expect(await screen.findByText('Subject t1')).toBeDefined()
    fireEvent.click(screen.getByRole('radio', { name: 'Unread' }))

    // The row (or the clear state) may render in both list and pane.
    expect((await screen.findAllByText(row)).length).toBeGreaterThan(0)
    expect(screen.queryByText('Subject t1')).toBeNull()
    if (row === 'Subject t2') {
      await expectPaneSubject(pane, 'Subject t2')
    } else {
      expect(screen.getByTestId('thread-empty')).toBeDefined()
    }
  })

  it('registers the three lenses on their shared components', () => {
    expect(lensById('commerce').Component).toBe(CommerceLens)
    expect(lensById('notifications').Component).toBe(NotificationsLens)
    expect(lensById('feed').Component).toBe(FeedLens)
    expect(lensById('messages').Component).not.toBe(CommerceLens)
  })
})
