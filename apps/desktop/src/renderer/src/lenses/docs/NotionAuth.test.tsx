import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DocSource } from '../../../../../../../packages/protocol/src/index'
import { RpcProvider } from '../../rpc/provider'
import { DOC_FIXTURES } from './fixtures'
import { DocsLens } from './DocsLens'

afterEach(() => {
  cleanup()
  delete (window as unknown as { moki?: unknown }).moki
  delete (window as unknown as { mokiZenCookies?: unknown }).mokiZenCookies
  window.history.replaceState({}, '', '/')
  vi.useRealTimers()
})

/* Single bridge setter: a method-level responder. */
function setBridge(
  respond: (method: string, params?: { source?: DocSource }) => Promise<unknown>
): void {
  ;(window as unknown as { moki: unknown }).moki = {
    call: (method: string, params?: { source?: DocSource }) => respond(method, params),
    on: () => () => {},
    openExternal: vi.fn().mockResolvedValue(undefined)
  }
}

function renderLens(): void {
  render(
    <RpcProvider>
      <DocsLens />
    </RpcProvider>
  )
}

function notionSection(): HTMLElement {
  return screen.getByTestId('docs-section-notion')
}

describe('Docs Notion sign-in flow', () => {
  it(
    'start→pending→done refetches live rows',
    async () => {
      let notionOpen = false
      const calls: string[] = []
      let polls = 0
      setBridge((method, params) => {
        calls.push(method)
        if (method === 'notion.signInStart') return Promise.resolve({ ok: true })
        if (method === 'notion.signInPoll') {
          polls += 1
          /* First poll still waiting; second completes and flips the
           * credential so the refetch lists rows. */
          if (polls === 1) return Promise.resolve({ status: 'pending' })
          notionOpen = true
          return Promise.resolve({ status: 'done', account: 'Notion' })
        }
        const source = (params as { source: DocSource }).source
        if (source === 'notion' && !notionOpen) {
          return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        }
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' })).toBeDefined()
      })
      // One quiet line about page selection, no token paste UI.
      expect(screen.queryByLabelText('Notion integration token')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Paste token' })).toBeNull()
      const before = calls.filter((method) => method === 'docs.listRecents').length
      expect(before).toBeGreaterThan(0)
      fireEvent.click(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' }))
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      expect(within(notionSection()).getByRole('button', { name: 'Cancel' })).toBeDefined()
      await waitFor(
        () => {
          expect(screen.getByTestId(`docs-row-${DOC_FIXTURES.notion[0].id}`)).toBeDefined()
        },
        { timeout: 10_000 }
      )
      expect(calls.filter((method) => method === 'docs.listRecents').length).toBeGreaterThan(before)
      // No token material reaches the DOM.
      expect(document.body.textContent).not.toMatch(/refresh_token|access_token|secret_/i)
    },
    20_000
  )

  it(
    'cancel stops polling',
    async () => {
      const calls: string[] = []
      setBridge((method, params) => {
        calls.push(method)
        if (method === 'notion.signInStart') return Promise.resolve({ ok: true })
        if (method === 'notion.signInPoll') return Promise.resolve({ status: 'pending' })
        if (method === 'notion.signInCancel') return Promise.resolve({ ok: true })
        const source = (params as { source: DocSource }).source
        if (source === 'notion') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' })).toBeDefined()
      })
      fireEvent.click(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' }))
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      await waitFor(
        () => {
          expect(calls.filter((method) => method === 'notion.signInPoll').length).toBeGreaterThanOrEqual(1)
        },
        { timeout: 10_000 }
      )
      fireEvent.click(within(notionSection()).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => {
        expect(
          within(notionSection()).getByRole('button', { name: 'Sign in with Notion' })
        ).toBeDefined()
      })
      expect(calls).toContain('notion.signInCancel')
      const pollsAtCancel = calls.filter((method) => method === 'notion.signInPoll').length
      await new Promise((resolve) => setTimeout(resolve, 2500))
      expect(calls.filter((method) => method === 'notion.signInPoll')).toHaveLength(pollsAtCancel)
    },
    20_000
  )

  it(
    'unmount mid-flow cancels the helper flow',
    async () => {
      const calls: string[] = []
      setBridge((method, params) => {
        calls.push(method)
        if (method === 'notion.signInStart') return Promise.resolve({ ok: true })
        if (method === 'notion.signInPoll') return Promise.resolve({ status: 'pending' })
        if (method === 'notion.signInCancel') return Promise.resolve({ ok: true })
        const source = (params as { source: DocSource }).source
        if (source === 'notion') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      const { unmount } = render(
        <RpcProvider>
          <DocsLens />
        </RpcProvider>
      )
      await waitFor(() => {
        expect(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' })).toBeDefined()
      })
      fireEvent.click(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' }))
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      unmount()
      await waitFor(() => {
        expect(calls).toContain('notion.signInCancel')
      })
    },
    20_000
  )

  it(
    'double-click starts only one flow',
    async () => {
      const calls: string[] = []
      let releaseStart!: () => void
      const started = new Promise<void>((resolve) => {
        releaseStart = resolve
      })
      setBridge((method, params) => {
        calls.push(method)
        if (method === 'notion.signInStart') return started.then(() => ({ ok: true }))
        if (method === 'notion.signInPoll') return Promise.resolve({ status: 'pending' })
        if (method === 'notion.signInCancel') return Promise.resolve({ ok: true })
        const source = (params as { source: DocSource }).source
        if (source === 'notion') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' })).toBeDefined()
      })
      fireEvent.click(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' }))
      fireEvent.click(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' }))
      // signInStart still pending: the second click must not bind a second flow.
      expect(calls.filter((called) => called === 'notion.signInStart')).toHaveLength(1)
      releaseStart()
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      fireEvent.click(within(notionSection()).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => {
        expect(
          within(notionSection()).getByRole('button', { name: 'Sign in with Notion' })
        ).toBeDefined()
      })
    },
    20_000
  )

  it(
    'error shows its message one-liner',
    async () => {
      setBridge((method, params) => {
        if (method === 'notion.signInStart') return Promise.resolve({ ok: true })
        if (method === 'notion.signInPoll') {
          return Promise.resolve({ status: 'error', message: 'Notion sign-in was declined (access_denied)' })
        }
        const source = (params as { source: DocSource }).source
        if (source === 'notion') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' })).toBeDefined()
      })
      fireEvent.click(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' }))
      await waitFor(
        () => {
          expect(screen.getByText('Notion sign-in was declined (access_denied)')).toBeDefined()
        },
        { timeout: 10_000 }
      )
      // Back at idle with the button available again.
      expect(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' })).toBeDefined()
    },
    20_000
  )

  it(
    'start failure stays idle with the quiet generic line',
    async () => {
      setBridge((method, params) => {
        if (method === 'notion.signInStart') return Promise.reject(new Error('helper exploded'))
        if (method === 'notion.signInPoll') return Promise.resolve({ status: 'pending' })
        const source = (params as { source: DocSource }).source
        if (source === 'notion') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' })).toBeDefined()
      })
      fireEvent.click(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' }))
      await waitFor(
        () => {
          expect(screen.getByText("Couldn't start Notion sign-in")).toBeDefined()
        },
        { timeout: 10_000 }
      )
      // Never left idle: no waiting state, no raw helper error, no poll storm.
      expect(screen.queryByText('Waiting for browser…')).toBeNull()
      expect(screen.queryByText('helper exploded')).toBeNull()
      expect(within(notionSection()).getByRole('button', { name: 'Sign in with Notion' })).toBeDefined()
    },
    20_000
  )

  it('signs out and empties the section immediately', async () => {
    let notionOpen = true
    const signedOut: string[] = []
    setBridge((method, params) => {
      if (method === 'notion.signOut') {
        signedOut.push(method)
        notionOpen = false
        return Promise.resolve({ ok: true })
      }
      const source = (params as { source: DocSource }).source
      if (source === 'notion' && notionOpen) {
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      }
      if (source === 'notion') {
        return Promise.resolve({ items: [], unreachable: false, signedOut: true })
      }
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    renderLens()
    await waitFor(() => {
      expect(
        within(screen.getByTestId('docs-section-notion')).getByRole('button', { name: 'Sign out' })
      ).toBeDefined()
    })
    fireEvent.click(
      within(screen.getByTestId('docs-section-notion')).getByRole('button', { name: 'Sign out' })
    )
    await waitFor(() => {
      expect(signedOut).toHaveLength(1)
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Notion needs sign-in')).toBeDefined()
    })
    expect(screen.queryByTestId(`docs-row-${DOC_FIXTURES.notion[0].id}`)).toBeNull()
  })

  it('shows a one-line notice when sign-out fails', async () => {
    setBridge((method, params) => {
      if (method === 'notion.signOut') return Promise.reject(new Error('down'))
      const source = (params as { source: DocSource }).source
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    renderLens()
    await waitFor(() => {
      expect(
        within(screen.getByTestId('docs-section-notion')).getByRole('button', { name: 'Sign out' })
      ).toBeDefined()
    })
    fireEvent.click(
      within(screen.getByTestId('docs-section-notion')).getByRole('button', { name: 'Sign out' })
    )
    await waitFor(() => {
      expect(screen.getByText("Couldn't sign out")).toBeDefined()
    })
  })
})
