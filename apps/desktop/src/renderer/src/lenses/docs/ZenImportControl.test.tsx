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

function setZenImport(respond: () => Promise<unknown>): void {
  ;(window as unknown as { mokiZenCookies?: unknown }).mokiZenCookies = {
    importCookies: respond
  }
}

function renderLens(): void {
  render(
    <RpcProvider>
      <DocsLens />
    </RpcProvider>
  )
}

/* The import mocks below speak the raw preload vocabulary ('google' group);
 * the control maps it to DocSource ('drive') at the getZenImporter
 * boundary, so the assertions read Drive/Notion/Craft. */
describe('Docs Zen import', () => {
  it('imports cookies, shows per-group status, and refetches recents', async () => {
    const recentsCalls: string[] = []
    setBridge((method, params) => {
      recentsCalls.push(method)
      const source = (params as { source: DocSource }).source
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    setZenImport(() =>
      Promise.resolve({ groups: { google: 'ok', notion: 'ok', craft: 'failed' }, imported: 5, skipped: 1 })
    )
    renderLens()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Import from Zen' })).toBeDefined()
    })
    const before = recentsCalls.filter((method) => method === 'docs.listRecents').length
    expect(before).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Import from Zen' }))
    await waitFor(() => {
      expect(screen.getByText('Imported 5 cookies — open a doc and it should be signed in')).toBeDefined()
    })
    expect(screen.getByText('Drive · signed in')).toBeDefined()
    expect(screen.getByText('Notion · signed in')).toBeDefined()
    expect(screen.getByText('Craft · no Zen cookies found')).toBeDefined()
    // Plain words now: the old cryptic per-group states are gone, and no
    // cookie names, hosts or values reach the renderer (counts only).
    expect(screen.queryByText('Drive · ok')).toBeNull()
    expect(screen.queryByText('Craft · failed')).toBeNull()
    expect(screen.getByLabelText('Zen import status').textContent).not.toMatch(/session|secret|=/i)
    await waitFor(() => {
      expect(recentsCalls.filter((method) => method === 'docs.listRecents').length).toBeGreaterThan(before)
    })
  })

  it('stays available for an idempotent re-import', async () => {
    let runs = 0
    setBridge((_method, params) => {
      const source = (params as { source: DocSource }).source
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    setZenImport(() => {
      runs += 1
      return Promise.resolve({ groups: { google: 'ok', notion: 'ok', craft: 'ok' }, imported: 5, skipped: 1 })
    })
    renderLens()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Import from Zen' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import from Zen' }))
    await waitFor(() => {
      expect(screen.getByText('Drive · signed in')).toBeDefined()
    })
    const button = screen.getByRole('button', { name: 'Import from Zen' })
    expect(button.getAttribute('disabled')).toBeNull()
    fireEvent.click(button)
    await waitFor(() => {
      expect(runs).toBe(2)
    })
  })

  it('explains when Zen has nothing to import', async () => {
    setBridge((_method, params) => {
      const source = (params as { source: DocSource }).source
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    setZenImport(() =>
      Promise.resolve({ groups: { google: 'failed', notion: 'failed', craft: 'failed' }, imported: 0, skipped: 0 })
    )
    renderLens()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Import from Zen' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import from Zen' }))
    await waitFor(() => {
      expect(screen.getByText('Zen may not be running or has no saved logins')).toBeDefined()
    })
    expect(screen.getByText('Drive · no Zen cookies found')).toBeDefined()
    expect(screen.getByText('Notion · no Zen cookies found')).toBeDefined()
    expect(screen.getByText('Craft · no Zen cookies found')).toBeDefined()
  })

  it('singularizes one imported cookie', async () => {
    setBridge((_method, params) => {
      const source = (params as { source: DocSource }).source
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    setZenImport(() =>
      Promise.resolve({ groups: { google: 'ok', notion: 'failed', craft: 'failed' }, imported: 1, skipped: 0 })
    )
    renderLens()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Import from Zen' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import from Zen' }))
    await waitFor(() => {
      expect(screen.getByText('Imported 1 cookie — open a doc and it should be signed in')).toBeDefined()
    })
  })

  it('hides the import control without the preload surface', async () => {
    setBridge((_method, params) => {
      const source = (params as { source: DocSource }).source
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    renderLens()
    await waitFor(() => {
      expect(screen.getByTestId(`docs-row-${DOC_FIXTURES.drive[0].id}`)).toBeDefined()
    })
    expect(screen.queryByRole('button', { name: 'Import from Zen' })).toBeNull()
  })

  it('shows a one-line notice when the import fails', async () => {
    setBridge((_method, params) => {
      const source = (params as { source: DocSource }).source
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    setZenImport(() => Promise.reject(new Error('zen down')))
    renderLens()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Import from Zen' })).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import from Zen' }))
    await waitFor(() => {
      expect(screen.getByText("Couldn't import from Zen")).toBeDefined()
    })
  })
})
