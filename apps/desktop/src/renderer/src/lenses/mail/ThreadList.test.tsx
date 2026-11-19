import type {
  AccountsListResult,
  MailListThreadsResult,
  ThreadSummary
} from '../../../../../../../packages/protocol/src/index'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RpcProvider } from '../../rpc/provider'
import { formatListDate } from './formatListDate'
import { useInboxThreads } from './hooks/useInboxThreads'
import { useSelectedThread } from './hooks/useSelectedThread'
import { ThreadList } from './ThreadList'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type Entry = { isIntersecting: boolean }

let seen: Array<(entries: Entry[]) => void> = []

function stubIntersectionObserver(): void {
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
}

function intersect(): void {
  act(() => {
    for (const callback of seen) callback([{ isIntersecting: true }])
  })
}

function thread(id: string, minutesAgo = 30): ThreadSummary {
  return {
    id,
    account: 'bubbles@example.com',
    from: { name: `Sender ${id}`, address: `${id}@example.com` },
    subject: `Subject ${id}`,
    snippet: `Snippet ${id}`,
    date: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    unread: false,
    messageCount: 1,
    pinned: false,
    labelIds: ['INBOX']
  }
}

function accounts(psymailImport: AccountsListResult['psymailImport']): AccountsListResult {
  return {
    accounts: [{ address: 'bubbles@example.com', name: 'Bubbles', status: 'ok' }],
    psymailImport
  }
}

function page(
  threads: ThreadSummary[],
  extra?: Partial<MailListThreadsResult>
): MailListThreadsResult {
  return { threads, unreachable: [], authExpired: [], ...extra }
}

interface BridgeState {
  accountsResult: AccountsListResult
  first: MailListThreadsResult
  second: MailListThreadsResult
  failMail?: boolean
  failAccounts?: boolean
}

function mockBridge(state: BridgeState): void {
  Object.defineProperty(window, 'moki', {
    value: {
      call: (method: string, params?: { cursor?: unknown }) => {
        if (method === 'accounts.list') {
          if (state.failAccounts === true) return Promise.reject(new Error('accounts down'))
          return Promise.resolve(state.accountsResult)
        }
        if (method === 'mail.listThreads') {
          if (state.failMail === true) return Promise.reject(new Error('helper down'))
          return Promise.resolve(params?.cursor !== undefined ? state.second : state.first)
        }
        return Promise.reject(new Error(`unexpected method ${method}`))
      },
      on: () => () => {},
      openExternal: () => Promise.resolve()
    },
    configurable: true
  })
}

function Harness(props?: { showSourceBadge?: boolean }): React.JSX.Element {
  const inbox = useInboxThreads()
  const { selection, select } = useSelectedThread(inbox.threads)
  return (
    <ThreadList
      query={inbox}
      selection={selection}
      onSelect={select}
      {...(props?.showSourceBadge === undefined ? {} : { showSourceBadge: props.showSourceBadge })}
    />
  )
}

function renderHarness(props?: { showSourceBadge?: boolean }): void {
  render(
    <RpcProvider>
      <Harness {...(props === undefined ? {} : props)} />
    </RpcProvider>
  )
}

describe('ThreadList', () => {
  beforeEach(() => {
    stubIntersectionObserver()
  })

  it('renders inbox rows and loads more on scroll', async () => {
    const firstPage = [thread('t1', 30), thread('t2', 90)]
    mockBridge({
      accountsResult: accounts('done'),
      first: page(firstPage, { next: { 'bubbles@example.com': '1' } }),
      second: page([thread('t3')])
    })
    renderHarness()

    expect(await screen.findByText('Subject t1')).toBeDefined()
    expect(screen.getByText('Subject t2')).toBeDefined()
    expect(screen.getByText(formatListDate(firstPage[0]!.date))).toBeDefined()

    intersect()
    expect(await screen.findByText('Subject t3')).toBeDefined()
  })

  it('auto-selects the first row and moves the highlight on click', async () => {
    mockBridge({
      accountsResult: accounts('done'),
      first: page([thread('t1'), thread('t2')]),
      second: page([])
    })
    renderHarness()

    await screen.findByText('Subject t1')
    // Selection lands in a useEffect after the rows render, so await it
    // instead of asserting synchronously (flaked in full-suite runs).
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Sender t1/ }).classList.contains('selected-lit')
      ).toBe(true)
    })

    fireEvent.click(screen.getByRole('button', { name: /Sender t2/ }))
    expect(screen.getByRole('button', { name: /Sender t2/ }).classList.contains('selected-lit')).toBe(
      true
    )
    expect(screen.getByRole('button', { name: /Sender t1/ }).classList.contains('selected-lit')).toBe(
      false
    )
  })

  it('stays newest-first across pages and drops duplicated rows', async () => {
    mockBridge({
      accountsResult: accounts('done'),
      first: page([thread('t1', 30), thread('t2', 90)], { next: { 'bubbles@example.com': '1' } }),
      // Second page overlaps the boundary (t1 again) and carries a newer row.
      second: page([thread('t0', 5), thread('t1', 30)])
    })
    renderHarness()

    await screen.findByText('Subject t1')
    intersect()
    await screen.findByText('Subject t0')
    const rows = screen.getAllByRole('button', { name: /Sender t/ })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      expect.stringContaining('Subject t0'),
      expect.stringContaining('Subject t1'),
      expect.stringContaining('Subject t2')
    ])
  })

  it('keeps loaded threads when accounts.list fails, with a one-line banner', async () => {
    mockBridge({
      accountsResult: accounts('done'),
      first: page([thread('t1', 30)]),
      second: page([]),
      failAccounts: true
    })
    renderHarness()

    // The row stays up: the accounts error must not replace loaded threads.
    expect(await screen.findByText('Subject t1', undefined, { timeout: 5000 })).toBeDefined()
    expect(screen.queryByText("Couldn't load the inbox")).toBeNull()
    expect(await screen.findByText('account info unavailable', undefined, { timeout: 5000 }))
      .toBeDefined()
  })

  it('shows the full error when accounts.list fails with nothing to show', async () => {
    mockBridge({
      accountsResult: accounts('done'),
      first: page([]),
      second: page([]),
      failAccounts: true
    })
    renderHarness()

    expect(await screen.findByText("Couldn't load the inbox", undefined, { timeout: 5000 }))
      .toBeDefined()
  })

  it('names unreachable and expired accounts in one banner line', async () => {
    mockBridge({
      accountsResult: accounts('done'),
      first: page([thread('t1')], {
        unreachable: ['a@example.com'],
        authExpired: ['b@example.com', 'c@example.com']
      }),
      second: page([])
    })
    renderHarness()

    expect(await screen.findByText('2 sign-ins expired · 1 unreachable')).toBeDefined()
    expect(screen.getByText('Subject t1')).toBeDefined()
  })

  it('shows an empty inbox quietly', async () => {
    mockBridge({ accountsResult: accounts('done'), first: page([]), second: page([]) })
    renderHarness()

    expect(await screen.findByText('Inbox is clear')).toBeDefined()
  })

  it('asks for Psymail sign-in when no accounts exist', async () => {
    mockBridge({
      accountsResult: { accounts: [], psymailImport: 'pending' },
      first: page([]),
      second: page([])
    })
    renderHarness()
    expect(await screen.findByText('Waiting for access to Psymail sign-ins')).toBeDefined()

    cleanup()
    stubIntersectionObserver()
    mockBridge({
      accountsResult: { accounts: [], psymailImport: 'done' },
      first: page([]),
      second: page([])
    })
    renderHarness()
    expect(await screen.findByText('Sign in to Gmail in Psymail')).toBeDefined()
  })

  it('shows a quiet error with retry when the inbox fails', async () => {
    mockBridge({
      accountsResult: accounts('done'),
      first: page([]),
      second: page([]),
      failMail: true
    })
    renderHarness()

    expect(await screen.findByText("Couldn't load the inbox", undefined, { timeout: 5000 }))
      .toBeDefined()
  })

  it('hides source badges by default and forwards the flag to every row', async () => {
    mockBridge({
      accountsResult: accounts('done'),
      first: page([thread('t1'), thread('t2')]),
      second: page([])
    })
    renderHarness()

    await screen.findByText('Subject t1')
    expect(screen.queryByRole('img', { name: 'Email' })).toBeNull()

    cleanup()
    stubIntersectionObserver()
    mockBridge({
      accountsResult: accounts('done'),
      first: page([thread('t1'), thread('t2')]),
      second: page([])
    })
    renderHarness({ showSourceBadge: true })

    await screen.findByText('Subject t1')
    expect(screen.getAllByRole('img', { name: 'Email' })).toHaveLength(2)
  })
})
