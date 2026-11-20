import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocItem, DocSource, DocsListRecentsResult } from '../../../../../../../packages/protocol/src/index'
import { RpcProvider } from '../../rpc/provider'
import { DOC_FIXTURES } from './fixtures'
import { DocsLens } from './DocsLens'
import { DocPreview } from './DocPreview'

afterEach(() => {
  cleanup()
  delete (window as unknown as { moki?: unknown }).moki
  window.history.replaceState({}, '', '/')
})

function setMockBridge(
  respond: (source: DocSource) => Promise<DocsListRecentsResult> | DocsListRecentsResult,
  openExternal?: () => Promise<void>
): void {
  ;(window as unknown as { moki: unknown }).moki = {
    call: (method: string, params?: { source?: DocSource }) => {
      if (method !== 'docs.listRecents' || params?.source === undefined) {
        return Promise.reject(new Error(`unexpected call ${method}`))
      }
      return Promise.resolve(respond(params.source))
    },
    on: () => () => {},
    openExternal: openExternal ?? vi.fn().mockResolvedValue(undefined)
  }
}

function renderLens(): void {
  render(
    <RpcProvider>
      <DocsLens />
    </RpcProvider>
  )
}

describe('docs fixtures', () => {
  it('carries 12 rows per source with real http(s) open URLs and ISO dates', () => {
    for (const source of ['drive', 'notion', 'craft'] as const) {
      const items = DOC_FIXTURES[source]
      expect(items).toHaveLength(12)
      for (const item of items) {
        expect(item.source).toBe(source)
        expect(item.openUrl).toMatch(/^https:\/\//)
        expect(Number.isNaN(Date.parse(item.updatedAt))).toBe(false)
      }
    }
    const ids = new Set<string>()
    for (const items of Object.values(DOC_FIXTURES)) {
      for (const item of items) {
        expect(ids.has(item.id)).toBe(false)
        ids.add(item.id)
      }
    }
  })
})

describe('DocsLens', () => {
  it('renders three sections with 12 rows each from fixtures', () => {
    renderLens()
    for (const source of ['drive', 'notion', 'craft']) {
      expect(screen.getByTestId(`docs-section-${source}`)).toBeDefined()
    }
    const rows = document.querySelectorAll('[data-testid^="docs-row-"]')
    expect(rows).toHaveLength(36)
  })

  it('clicking a row opens its URL in the right pane', () => {
    renderLens()
    const target = DOC_FIXTURES.notion[3]
    fireEvent.click(screen.getByTestId(`docs-row-${target.id}`))
    const frame = screen.getByTestId('docs-preview-frame')
    expect(frame.getAttribute('src')).toBe(target.openUrl)
  })

  it('a single selection replaces the pane', () => {
    renderLens()
    const first = DOC_FIXTURES.drive[0]
    const other = DOC_FIXTURES.craft[5]
    expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(first.openUrl)
    fireEvent.click(screen.getByTestId(`docs-row-${other.id}`))
    expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(other.openUrl)
    expect(screen.getByTestId(`docs-row-${other.id}`).getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId(`docs-row-${first.id}`).getAttribute('aria-current')).toBe('false')
  })

  it('preselects ?mokiDoc= for captures', () => {
    const target = DOC_FIXTURES.craft[2]
    window.history.replaceState({}, '', `/?mokiDoc=${target.id}`)
    renderLens()
    expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(target.openUrl)
  })

  it('loads the preview guest with the shared hardened attributes', () => {
    renderLens()
    const frame = screen.getByTestId('docs-preview-frame')
    expect(frame.getAttribute('partition')).toBe('persist:moki-websites')
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('allowpopups')).toBe('')
  })

  it('shows signed-out sections with their sign-in state', async () => {
    setMockBridge((source) =>
      source === 'notion'
        ? { items: [], unreachable: false, signedOut: true }
        : { items: DOC_FIXTURES[source], unreachable: false, signedOut: false }
    )
    renderLens()
    await waitFor(() => {
      expect(screen.getByLabelText('Notion needs sign-in')).toBeDefined()
    })
    // Live sources render their rows; the signed-out one shows no rows.
    expect(document.querySelectorAll('[data-testid^="docs-row-"]').length).toBeGreaterThan(0)
    expect(screen.queryByTestId(`docs-row-${DOC_FIXTURES.notion[0].id}`)).toBeNull()
  })

  it('keeps listed rows up with an unreachable notice', async () => {
    const live: DocItem[] = [DOC_FIXTURES.drive[0]]
    setMockBridge((source) =>
      source === 'drive'
        ? { items: live, unreachable: true, signedOut: false }
        : { items: DOC_FIXTURES[source], unreachable: false, signedOut: false }
    )
    renderLens()
    await waitFor(() => {
      expect(screen.getByText('Drive is unreachable')).toBeDefined()
    })
    expect(screen.getByTestId(`docs-row-${live[0].id}`)).toBeDefined()
  })

  it('degrades a failed listing to fixtures with a partial notice', async () => {
    setMockBridge(() => Promise.reject(new Error('down')))
    renderLens()
    await waitFor(() => {
      expect(screen.getAllByText("Couldn't refresh — showing saved list")).toHaveLength(3)
    })
    expect(document.querySelectorAll('[data-testid^="docs-row-"]')).toHaveLength(36)
  })
})

describe('DocPreview', () => {
  it('asks for a selection when empty', () => {
    render(<DocPreview doc={null} />)
    expect(screen.getByTestId('docs-preview-empty')).toBeDefined()
  })

  it('opens the shown URL in the browser', () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    setMockBridge(() => ({ items: [], unreachable: false, signedOut: false }), openExternal)
    render(<DocPreview doc={DOC_FIXTURES.drive[1]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(openExternal).toHaveBeenCalledWith(DOC_FIXTURES.drive[1].openUrl)
  })
})
