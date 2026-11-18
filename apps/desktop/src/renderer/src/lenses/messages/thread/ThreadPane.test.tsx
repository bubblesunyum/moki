import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { ThreadDetail } from '../../../../../../../../packages/protocol/src/index'
import { ThreadPane } from './ThreadPane'

const THREAD: ThreadDetail = {
  id: 't1',
  account: 'me@gmail.com',
  subject: 'Plant swap this weekend?',
  messages: [
    {
      id: 'm1',
      from: { name: 'Brooke Churchill', address: 'brooke@example.com' },
      to: [],
      cc: [],
      date: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      html: '<p>Hey! Tables at Cherrywood. <script>alert(1)</script></p>',
      text: null,
      isFromMe: false
    },
    {
      id: 'm2',
      from: { name: 'Me', address: 'me@gmail.com' },
      to: [],
      cc: [],
      date: new Date().toISOString(),
      html: null,
      text: 'yes! details at https://example.com/swap',
      isFromMe: true
    }
  ]
}

function mockMokiCall(impl: (method: unknown, params: unknown) => Promise<unknown>) {
  const call = vi.fn(impl)
  Object.defineProperty(window, 'moki', {
    value: { call, on: vi.fn(() => () => {}), openExternal: vi.fn(async () => {}) },
    configurable: true
  })
  return call
}

function renderPane(selection: { account: string; id: string } | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <ThreadPane selection={selection} />
    </QueryClientProvider>
  )
  const rendered = render(ui)
  return { ...rendered, client }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ThreadPane', () => {
  it('shows the empty state and fetches nothing without a selection', () => {
    const call = mockMokiCall(async () => THREAD)
    renderPane(null)
    expect(screen.getByTestId('thread-empty').textContent).toContain('Select a conversation')
    expect(call).not.toHaveBeenCalled()
  })

  it('shows skeleton cards while loading', () => {
    mockMokiCall(() => new Promise(() => {}))
    renderPane({ account: 'me@gmail.com', id: 't1' })
    expect(screen.getByTestId('thread-loading')).not.toBeNull()
  })

  it('shows an error line with a retry that refetches', async () => {
    const call = mockMokiCall(async () => {
      throw new Error('down')
    })
    renderPane({ account: 'me@gmail.com', id: 't1' })
    await screen.findByTestId('thread-error')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(call.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('renders the subject and each message newest at the bottom', async () => {    mockMokiCall(async () => THREAD)
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(500)
    renderPane({ account: 'me@gmail.com', id: 't1' })

    await screen.findByTestId('thread-subject')
    expect(screen.getByTestId('thread-subject').textContent).toContain(
      'Plant swap this weekend?'
    )
    const cards = screen.getAllByTestId(/^email-card-/)
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual([
      'email-card-m1',
      'email-card-m2'
    ])
    // Sanitized HTML: body text kept, script dropped.
    const htmlHost = within(screen.getByTestId('email-card-m1')).getByTestId('email-html')
    expect(htmlHost.shadowRoot?.textContent).toContain('Tables at Cherrywood')
    expect(htmlHost.shadowRoot?.innerHTML).not.toContain('alert(1)')
    // Own messages are full width, marked 'You'.
    expect(screen.getByText('You')).not.toBeNull()
    // Plain-text URL autolinked.
    expect(screen.getByTestId('email-card-m2').querySelector('a')).not.toBeNull()
    // Scrolled to the bottom on open.
    await waitFor(() =>
      expect(screen.getByTestId('thread-scroll').scrollTop).toBe(500)
    )
    scrollHeight.mockRestore()
  })

  it('scrolls only when the selected thread changes, not on refetch', async () => {
    const byId: Record<string, ThreadDetail> = {
      t1: { ...THREAD, id: 't1', subject: 'First thread' },
      t2: { ...THREAD, id: 't2', subject: 'Second thread' }
    }
    mockMokiCall(async (_method, params) => byId[(params as { id: string }).id] ?? THREAD)
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(500)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pane = ({ id }: { id: string }): ReactElement => (
      <QueryClientProvider client={client}>
        <ThreadPane selection={{ account: 'me@gmail.com', id }} />
      </QueryClientProvider>
    )
    const view = render(pane({ id: 't1' }))
    await screen.findByTestId('thread-subject')
    expect(screen.getByTestId('thread-subject').textContent).toContain('First thread')
    await waitFor(() => expect(screen.getByTestId('thread-scroll').scrollTop).toBe(500))

    // A refetch of the same thread (new data, same account+id) holds still.
    const scroller = screen.getByTestId('thread-scroll')
    scroller.scrollTop = 42
    await act(async () => {
      await client.refetchQueries()
    })
    expect(screen.getByTestId('thread-scroll').scrollTop).toBe(42)

    // Selecting another thread scrolls to the bottom again.
    view.rerender(pane({ id: 't2' }))
    await waitFor(() =>
      expect(screen.getByTestId('thread-subject').textContent).toContain('Second thread')
    )
    await waitFor(() => expect(screen.getByTestId('thread-scroll').scrollTop).toBe(500))
    scrollHeight.mockRestore()
  })
})
