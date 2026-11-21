import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DocItem, DocSource } from '../../../../../../../packages/protocol/src/index'
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

type Params = { source?: DocSource; url?: string } | undefined

function setBridge(
  respond: (method: string, params?: Params) => Promise<unknown>,
  options?: { openExternal?: () => Promise<void> }
): { openExternal: ReturnType<typeof vi.fn> } {
  const openExternal = vi.fn().mockResolvedValue(undefined)
  ;(window as unknown as { moki: unknown }).moki = {
    call: (method: string, params?: Params) => respond(method, params),
    on: () => () => {},
    openExternal: options?.openExternal ?? openExternal
  }
  return { openExternal }
}

function renderLens(): void {
  render(
    <RpcProvider>
      <DocsLens />
    </RpcProvider>
  )
}

function driveSection(): HTMLElement {
  return screen.getByTestId('docs-section-drive')
}

function craftSection(): HTMLElement {
  return screen.getByTestId('docs-section-craft')
}

describe('Docs Google sign-in flow', () => {
  it(
    'start→pending→done refetches live rows',
    async () => {
      let driveOpen = false
      const calls: string[] = []
      let polls = 0
      setBridge((method, params) => {
        calls.push(method)
        if (method === 'google.signInStart') return Promise.resolve({ ok: true })
        if (method === 'google.signInPoll') {
          polls += 1
          /* First poll still waiting; second completes and flips the
           * credential so the refetch lists rows. */
          if (polls === 1) return Promise.resolve({ status: 'pending' })
          driveOpen = true
          return Promise.resolve({ status: 'done', account: 'tansy@example.com' })
        }
        const source = (params as { source: DocSource }).source
        if (source === 'drive' && !driveOpen) {
          return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        }
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(driveSection()).getByRole('button', { name: 'Sign in with Google' })).toBeDefined()
      })
      const before = calls.filter((method) => method === 'docs.listRecents').length
      expect(before).toBeGreaterThan(0)
      fireEvent.click(within(driveSection()).getByRole('button', { name: 'Sign in with Google' }))
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      expect(within(driveSection()).getByRole('button', { name: 'Cancel' })).toBeDefined()
      await waitFor(
        () => {
          expect(screen.getByTestId(`docs-row-${DOC_FIXTURES.drive[0].id}`)).toBeDefined()
        },
        { timeout: 10_000 }
      )
      expect(calls.filter((method) => method === 'docs.listRecents').length).toBeGreaterThan(before)
      // No token material reaches the DOM.
      expect(document.body.textContent).not.toMatch(/refresh_token|access_token/i)
    },
    20_000
  )

  it(
    'cancel stops polling',
    async () => {
      const calls: string[] = []
      setBridge((method, params) => {
        calls.push(method)
        if (method === 'google.signInStart') return Promise.resolve({ ok: true })
        if (method === 'google.signInPoll') return Promise.resolve({ status: 'pending' })
        if (method === 'google.signInCancel') return Promise.resolve({ ok: true })
        const source = (params as { source: DocSource }).source
        if (source === 'drive') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(driveSection()).getByRole('button', { name: 'Sign in with Google' })).toBeDefined()
      })
      fireEvent.click(within(driveSection()).getByRole('button', { name: 'Sign in with Google' }))
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      await waitFor(
        () => {
          expect(calls.filter((method) => method === 'google.signInPoll').length).toBeGreaterThanOrEqual(1)
        },
        { timeout: 10_000 }
      )
      fireEvent.click(within(driveSection()).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => {
        expect(
          within(driveSection()).getByRole('button', { name: 'Sign in with Google' })
        ).toBeDefined()
      })
      expect(calls).toContain('google.signInCancel')
      const pollsAtCancel = calls.filter((method) => method === 'google.signInPoll').length
      await new Promise((resolve) => setTimeout(resolve, 2500))
      expect(calls.filter((method) => method === 'google.signInPoll')).toHaveLength(pollsAtCancel)
    },
    20_000
  )

  it(
    'unmount mid-flow cancels the helper flow',
    async () => {
      const calls: string[] = []
      setBridge((method, params) => {
        calls.push(method)
        if (method === 'google.signInStart') return Promise.resolve({ ok: true })
        if (method === 'google.signInPoll') return Promise.resolve({ status: 'pending' })
        if (method === 'google.signInCancel') return Promise.resolve({ ok: true })
        const source = (params as { source: DocSource }).source
        if (source === 'drive') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      const { unmount } = render(
        <RpcProvider>
          <DocsLens />
        </RpcProvider>
      )
      await waitFor(() => {
        expect(within(driveSection()).getByRole('button', { name: 'Sign in with Google' })).toBeDefined()
      })
      fireEvent.click(within(driveSection()).getByRole('button', { name: 'Sign in with Google' }))
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      unmount()
      await waitFor(() => {
        expect(calls).toContain('google.signInCancel')
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
        if (method === 'google.signInStart') return started.then(() => ({ ok: true }))
        if (method === 'google.signInPoll') return Promise.resolve({ status: 'pending' })
        if (method === 'google.signInCancel') return Promise.resolve({ ok: true })
        const source = (params as { source: DocSource }).source
        if (source === 'drive') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(driveSection()).getByRole('button', { name: 'Sign in with Google' })).toBeDefined()
      })
      fireEvent.click(within(driveSection()).getByRole('button', { name: 'Sign in with Google' }))
      fireEvent.click(within(driveSection()).getByRole('button', { name: 'Sign in with Google' }))
      // signInStart still pending: the second click must not bind a second flow.
      expect(calls.filter((called) => called === 'google.signInStart')).toHaveLength(1)
      releaseStart()
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      fireEvent.click(within(driveSection()).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => {
        expect(
          within(driveSection()).getByRole('button', { name: 'Sign in with Google' })
        ).toBeDefined()
      })
    },
    20_000
  )

  it(
    'error shows its message one-liner',
    async () => {
      setBridge((method, params) => {
        if (method === 'google.signInStart') return Promise.resolve({ ok: true })
        if (method === 'google.signInPoll') {
          return Promise.resolve({ status: 'error', message: 'Consent timed out' })
        }
        const source = (params as { source: DocSource }).source
        if (source === 'drive') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(driveSection()).getByRole('button', { name: 'Sign in with Google' })).toBeDefined()
      })
      fireEvent.click(within(driveSection()).getByRole('button', { name: 'Sign in with Google' }))
      await waitFor(
        () => {
          expect(screen.getByText('Consent timed out')).toBeDefined()
        },
        { timeout: 10_000 }
      )
      // Back at idle with the button available again.
      expect(within(driveSection()).getByRole('button', { name: 'Sign in with Google' })).toBeDefined()
    },
    20_000
  )
})

describe('Docs Craft sign-in flow', () => {
  function liveCraftRows(): DocItem[] {
    return [0, 1].map((index) => ({
      id: `craft-live-${index}`,
      title: `Craft live ${index}`,
      source: 'craft' as const,
      updatedAt: new Date(Date.now() - index * 60_000).toISOString(),
      openUrl: '',
      deepLink: `craftdocs://open?blockId=live-${index}`
    }))
  }

  it(
    'start→pending→done refetches live rows',
    async () => {
      let craftOpen = false
      const calls: string[] = []
      let polls = 0
      setBridge((method, params) => {
        calls.push(method)
        if (method === 'craft.signInStart') return Promise.resolve({ ok: true })
        if (method === 'craft.signInPoll') {
          polls += 1
          /* First poll still waiting; second completes and flips the
           * credential so the refetch lists rows. */
          if (polls === 1) return Promise.resolve({ status: 'pending' })
          craftOpen = true
          return Promise.resolve({ status: 'done' })
        }
        const source = (params as { source: DocSource }).source
        if (source === 'craft' && !craftOpen) {
          return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        }
        if (source === 'craft') {
          return Promise.resolve({ items: liveCraftRows(), unreachable: false, signedOut: false })
        }
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' })).toBeDefined()
      })
      // One quiet line about the space approval, no connection-URL form.
      expect(screen.getByText(/Choose a space in Craft/)).toBeDefined()
      expect(screen.queryByLabelText('Craft connection URL')).toBeNull()
      const before = calls.filter((method) => method === 'docs.listRecents').length
      expect(before).toBeGreaterThan(0)
      fireEvent.click(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' }))
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      expect(within(craftSection()).getByRole('button', { name: 'Cancel' })).toBeDefined()
      await waitFor(
        () => {
          expect(screen.getByTestId('docs-row-craft-live-0')).toBeDefined()
        },
        { timeout: 10_000 }
      )
      expect(calls.filter((method) => method === 'docs.listRecents').length).toBeGreaterThan(before)
      // No token material reaches the DOM.
      expect(document.body.textContent).not.toMatch(/refresh_token|access_token|connect\.craft\.do/i)
    },
    20_000
  )

  it(
    'cancel stops polling',
    async () => {
      const calls: string[] = []
      setBridge((method, params) => {
        calls.push(method)
        if (method === 'craft.signInStart') return Promise.resolve({ ok: true })
        if (method === 'craft.signInPoll') return Promise.resolve({ status: 'pending' })
        if (method === 'craft.signInCancel') return Promise.resolve({ ok: true })
        const source = (params as { source: DocSource }).source
        if (source === 'craft') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' })).toBeDefined()
      })
      fireEvent.click(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' }))
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      await waitFor(
        () => {
          expect(calls.filter((method) => method === 'craft.signInPoll').length).toBeGreaterThanOrEqual(1)
        },
        { timeout: 10_000 }
      )
      fireEvent.click(within(craftSection()).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => {
        expect(
          within(craftSection()).getByRole('button', { name: 'Sign in with Craft' })
        ).toBeDefined()
      })
      expect(calls).toContain('craft.signInCancel')
      const pollsAtCancel = calls.filter((method) => method === 'craft.signInPoll').length
      await new Promise((resolve) => setTimeout(resolve, 2500))
      expect(calls.filter((method) => method === 'craft.signInPoll')).toHaveLength(pollsAtCancel)
    },
    20_000
  )

  it(
    'unmount mid-flow cancels the helper flow',
    async () => {
      const calls: string[] = []
      setBridge((method, params) => {
        calls.push(method)
        if (method === 'craft.signInStart') return Promise.resolve({ ok: true })
        if (method === 'craft.signInPoll') return Promise.resolve({ status: 'pending' })
        if (method === 'craft.signInCancel') return Promise.resolve({ ok: true })
        const source = (params as { source: DocSource }).source
        if (source === 'craft') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      const { unmount } = render(
        <RpcProvider>
          <DocsLens />
        </RpcProvider>
      )
      await waitFor(() => {
        expect(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' })).toBeDefined()
      })
      fireEvent.click(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' }))
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      unmount()
      await waitFor(() => {
        expect(calls).toContain('craft.signInCancel')
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
        if (method === 'craft.signInStart') return started.then(() => ({ ok: true }))
        if (method === 'craft.signInPoll') return Promise.resolve({ status: 'pending' })
        if (method === 'craft.signInCancel') return Promise.resolve({ ok: true })
        const source = (params as { source: DocSource }).source
        if (source === 'craft') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' })).toBeDefined()
      })
      fireEvent.click(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' }))
      fireEvent.click(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' }))
      // signInStart still pending: the second click must not bind a second flow.
      expect(calls.filter((called) => called === 'craft.signInStart')).toHaveLength(1)
      releaseStart()
      await waitFor(() => {
        expect(screen.getByText('Waiting for browser…')).toBeDefined()
      })
      fireEvent.click(within(craftSection()).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => {
        expect(
          within(craftSection()).getByRole('button', { name: 'Sign in with Craft' })
        ).toBeDefined()
      })
    },
    20_000
  )

  it(
    'error shows its message one-liner',
    async () => {
      setBridge((method, params) => {
        if (method === 'craft.signInStart') return Promise.resolve({ ok: true })
        if (method === 'craft.signInPoll') {
          return Promise.resolve({ status: 'error', message: 'Consent timed out' })
        }
        const source = (params as { source: DocSource }).source
        if (source === 'craft') return Promise.resolve({ items: [], unreachable: false, signedOut: true })
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      })
      renderLens()
      await waitFor(() => {
        expect(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' })).toBeDefined()
      })
      fireEvent.click(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' }))
      await waitFor(
        () => {
          expect(screen.getByText('Consent timed out')).toBeDefined()
        },
        { timeout: 10_000 }
      )
      // Back at idle with the button available again.
      expect(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' })).toBeDefined()
    },
    20_000
  )

  it('craft sign-out flips to signed-out', async () => {
    let craftOpen = true
    setBridge((method, params) => {
      if (method === 'craftConnect.signOut') {
        craftOpen = false
        return Promise.resolve({ ok: true })
      }
      const source = (params as { source: DocSource }).source
      if (source === 'craft' && !craftOpen) {
        return Promise.resolve({ items: [], unreachable: false, signedOut: true })
      }
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    renderLens()
    await waitFor(() => {
      expect(
        within(craftSection()).getByRole('button', { name: 'Sign out' })
      ).toBeDefined()
    })
    fireEvent.click(within(craftSection()).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Craft needs sign-in')).toBeDefined()
    })
    // The OAuth control is back, not the old connection-URL form.
    expect(within(craftSection()).getByRole('button', { name: 'Sign in with Craft' })).toBeDefined()
    expect(screen.getByText(/Choose a space in Craft/)).toBeDefined()
    expect(screen.queryByTestId(`docs-row-${DOC_FIXTURES.craft[0].id}`)).toBeNull()
  })

  it('deep-link rows open externally without touching the selection', async () => {
    const { openExternal } = setBridge(
      (_method, params) => {
        const source = (params as { source: DocSource }).source
        if (source === 'craft') {
          return Promise.resolve({ items: liveCraftRows(), unreachable: false, signedOut: false })
        }
        return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
      }
    )
    renderLens()
    await waitFor(() => {
      expect(screen.getByTestId('docs-row-craft-live-0')).toBeDefined()
    })
    // Copy honesty: the Craft section never calls its rows recent.
    expect(craftSection().textContent).not.toMatch(/recent/i)
    expect(screen.getByText('In space order')).toBeDefined()
    const before = (screen.getByTestId('docs-preview-frame').getAttribute('src') as string) ?? ''
    expect(before).toBe(DOC_FIXTURES.drive[0].openUrl)
    fireEvent.click(screen.getByTestId('docs-row-craft-live-0'))
    expect(openExternal).toHaveBeenCalledWith('craftdocs://open?blockId=live-0')
    // Selection untouched: the preview stays and no row lights up.
    expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(before)
    expect(screen.getByTestId('docs-row-craft-live-0').getAttribute('aria-current')).toBe('false')
    expect(document.body.textContent).not.toContain('craftdocs://open?blockId=live-0')
  })
})
