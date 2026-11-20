import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocSource } from '../../../../../../../packages/protocol/src/index'
import { RpcProvider } from '../../rpc/provider'
import { DOC_FIXTURES } from './fixtures'
import { DocsLens } from './DocsLens'

afterEach(() => {
  cleanup()
  delete (window as unknown as { moki?: unknown }).moki
  delete (window as unknown as { mokiZenCookies?: unknown }).mokiZenCookies
  window.history.replaceState({}, '', '/')
})

/* Single bridge setter: a method-level responder plus an optional
 * openExternal override (DocPreview's "open in browser" test). */
function setBridge(
  respond: (method: string, params?: { source?: DocSource }) => Promise<unknown>,
  options?: { openExternal?: () => Promise<void> }
): void {
  ;(window as unknown as { moki: unknown }).moki = {
    call: (method: string, params?: { source?: DocSource }) => respond(method, params),
    on: () => () => {},
    openExternal: options?.openExternal ?? vi.fn().mockResolvedValue(undefined)
  }
}

function renderLens(): void {
  render(
    <RpcProvider>
      <DocsLens />
    </RpcProvider>
  )
}

describe('Docs Notion auth', () => {
  it('pastes a token to sign in, then refetches without keeping the token', async () => {
    let notionOpen = true
    const saved: unknown[] = []
    setBridge((method, params) => {
      if (method === 'notion.setToken') {
        saved.push(params)
        notionOpen = false
        return Promise.resolve({ ok: true })
      }
      const source = (params as { source: DocSource }).source
      if (source === 'notion' && notionOpen) {
        return Promise.resolve({ items: [], unreachable: false, signedOut: true })
      }
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    renderLens()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Paste token' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Paste token' }))
    const input = screen.getByLabelText('Notion integration token')
    fireEvent.change(input, { target: { value: 'secret_test-token' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await waitFor(() => {
      expect(saved).toHaveLength(1)
    })
    expect(saved[0]).toEqual({ token: 'secret_test-token' })
    await waitFor(() => {
      expect(screen.getByTestId(`docs-row-${DOC_FIXTURES.notion[0].id}`)).toBeDefined()
    })
    // Passed straight through: the token never lingers in the DOM.
    expect(document.body.textContent).not.toContain('secret_test-token')
  })

  it('shows a one-line notice when saving the token fails', async () => {
    setBridge((method, params) => {
      if (method === 'notion.setToken') return Promise.reject(new Error('bad token'))
      const source = (params as { source: DocSource }).source
      return Promise.resolve({
        items: source === 'notion' ? [] : DOC_FIXTURES[source],
        unreachable: false,
        signedOut: source === 'notion'
      })
    })
    renderLens()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Paste token' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Paste token' }))
    const input = screen.getByLabelText('Notion integration token')
    fireEvent.change(input, { target: { value: 'secret_bogus' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await waitFor(() => {
      expect(screen.getByText("Couldn't save that token")).toBeDefined()
    })
  })

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
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
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
      expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => {
      expect(screen.getByText("Couldn't sign out")).toBeDefined()
    })
  })
})
