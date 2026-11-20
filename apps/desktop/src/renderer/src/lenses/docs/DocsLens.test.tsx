import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocItem, DocSource } from '../../../../../../../packages/protocol/src/index'
import { RpcProvider } from '../../rpc/provider'
import { DOC_FIXTURES } from './fixtures'
import { DocsLens } from './DocsLens'
import { DocPreview } from './DocPreview'

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

  /* Cross-side contract: the id/title/URL lists below are checked in on
   * both sides (mirror: "fixtureRowsMirrorCanonicalContract" in
   * DocsRecentsTests.swift). TS and Swift cannot share one fixture file, so
   * a fixture change on either side without the other fails here or there.
   * Change rows in fixtures.ts AND the Swift mirrors together. */
  it('mirrors the canonical contract the helper fixtures pin', () => {
    const canonical: Record<DocSource, Array<[id: string, title: string, openUrl: string]>> = {
      drive: [
        ['1a2b3c4d5e6f7g8h9i0j', 'Launch plan v3', 'https://drive.google.com/file/d/1a2b3c4d5e6f7g8h9i0j/view'],
        ['2b3c4d5e6f7g8h9i0j1k', 'Board deck — November', 'https://drive.google.com/file/d/2b3c4d5e6f7g8h9i0j1k/view'],
        ['3c4d5e6f7g8h9i0j1k2l', 'Hiring rubric', 'https://drive.google.com/file/d/3c4d5e6f7g8h9i0j1k2l/view'],
        ['4d5e6f7g8h9i0j1k2l3m', 'Pricing experiments', 'https://drive.google.com/file/d/4d5e6f7g8h9i0j1k2l3m/view'],
        ['5e6f7g8h9i0j1k2l3m4n', 'Offsite notes', 'https://drive.google.com/file/d/5e6f7g8h9i0j1k2l3m4n/view'],
        ['6f7g8h9i0j1k2l3m4n5o', 'Q4 budget', 'https://drive.google.com/file/d/6f7g8h9i0j1k2l3m4n5o/view'],
        ['7g8h9i0j1k2l3m4n5o6p', 'Design critique thread', 'https://drive.google.com/file/d/7g8h9i0j1k2l3m4n5o6p/view'],
        ['8h9i0j1k2l3m4n5o6p7q', 'API migration checklist', 'https://drive.google.com/file/d/8h9i0j1k2l3m4n5o6p7q/view'],
        ['9i0j1k2l3m4n5o6p7q8r', 'Customer visit notes', 'https://drive.google.com/file/d/9i0j1k2l3m4n5o6p7q8r/view'],
        ['0j1k2l3m4n5o6p7q8r9s', 'Brand refresh brief', 'https://drive.google.com/file/d/0j1k2l3m4n5o6p7q8r9s/view'],
        ['1k2l3m4n5o6p7q8r9s0t', 'All-hands agenda', 'https://drive.google.com/file/d/1k2l3m4n5o6p7q8r9s0t/view'],
        ['2l3m4n5o6p7q8r9s0t1u', 'Reading list', 'https://drive.google.com/file/d/2l3m4n5o6p7q8r9s0t1u/view']
      ],
      notion: [
        ['Tansy-Roadmap-9f2c1a', 'Tansy roadmap', 'https://www.notion.so/Tansy-Roadmap-9f2c1a'],
        ['Weekly-Review-7d4b2e', 'Weekly review', 'https://www.notion.so/Weekly-Review-7d4b2e'],
        ['Meeting-Notes-3a8f1c', 'Meeting notes', 'https://www.notion.so/Meeting-Notes-3a8f1c'],
        ['Product-Spec-5e6a9d', 'Life OS spec', 'https://www.notion.so/Product-Spec-5e6a9d'],
        ['Habit-Tracker-1b3d7f', 'Habit tracker', 'https://www.notion.so/Habit-Tracker-1b3d7f'],
        ['Book-Notes-8c2e4a', 'Book notes', 'https://www.notion.so/Book-Notes-8c2e4a'],
        ['Travel-Plans-6f1a3c', 'Travel plans', 'https://www.notion.so/Travel-Plans-6f1a3c'],
        ['Gift-Ideas-2d9b5e', 'Gift ideas', 'https://www.notion.so/Gift-Ideas-2d9b5e'],
        ['Home-Renovation-4a7c1e', 'Home renovation', 'https://www.notion.so/Home-Renovation-4a7c1e'],
        ['Side-Project-9e3f8b', 'Side project log', 'https://www.notion.so/Side-Project-9e3f8b'],
        ['Recipes-5b8d2f', 'Recipes', 'https://www.notion.so/Recipes-5b8d2f'],
        ['Journal-7c1e6a', 'Journal', 'https://www.notion.so/Journal-7c1e6a']
      ],
      craft: [
        ['s/launch-checklist-a1b2c3', 'Launch checklist', 'https://www.craft.do/s/launch-checklist-a1b2c3'],
        ['s/essay-draft-d4e5f6', 'Essay draft', 'https://www.craft.do/s/essay-draft-d4e5f6'],
        ['s/trip-itinerary-g7h8i9', 'Trip itinerary', 'https://www.craft.do/s/trip-itinerary-g7h8i9'],
        ['s/reading-notes-j0k1l2', 'Reading notes', 'https://www.craft.do/s/reading-notes-j0k1l2'],
        ['s/garden-plan-m3n4o5', 'Garden plan', 'https://www.craft.do/s/garden-plan-m3n4o5'],
        ['s/talk-outline-p6q7r8', 'Talk outline', 'https://www.craft.do/s/talk-outline-p6q7r8'],
        ['s/budget-review-s9t0u1', 'Budget review', 'https://www.craft.do/s/budget-review-s9t0u1'],
        ['s/book-club-v2w3x4', 'Book club picks', 'https://www.craft.do/s/book-club-v2w3x4'],
        ['s/workout-log-y5z6a7', 'Workout log', 'https://www.craft.do/s/workout-log-y5z6a7'],
        ['s/gift-list-b8c9d0', 'Gift list', 'https://www.craft.do/s/gift-list-b8c9d0'],
        ['s/home-inventory-e1f2g3', 'Home inventory', 'https://www.craft.do/s/home-inventory-e1f2g3'],
        ['s/ideas-inbox-h4i5j6', 'Ideas inbox', 'https://www.craft.do/s/ideas-inbox-h4i5j6']
      ]
    }
    for (const source of ['drive', 'notion', 'craft'] as const) {
      const items = DOC_FIXTURES[source]
      expect(items.map((item) => [item.id, item.title, item.openUrl])).toEqual(canonical[source])
      // Within the last day, newest first — so ?mokiDoc pins and any
      // recency filter hold at any wall-clock time.
      const stamps = items.map((item) => Date.parse(item.updatedAt))
      for (const stamp of stamps) {
        expect(Date.now() - stamp).toBeGreaterThanOrEqual(0)
        expect(Date.now() - stamp).toBeLessThan(24 * 60 * 60 * 1000)
      }
      expect([...stamps].sort((a, b) => b - a)).toEqual(stamps)
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
    setBridge((_method, params) => {
      const source = (params as { source: DocSource }).source
      return Promise.resolve(
        source === 'notion'
          ? { items: [], unreachable: false, signedOut: true }
          : { items: DOC_FIXTURES[source], unreachable: false, signedOut: false }
      )
    })
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
    setBridge((_method, params) => {
      const source = (params as { source: DocSource }).source
      return Promise.resolve(
        source === 'drive'
          ? { items: live, unreachable: true, signedOut: false }
          : { items: DOC_FIXTURES[source], unreachable: false, signedOut: false }
      )
    })
    renderLens()
    await waitFor(() => {
      expect(screen.getByText('Drive is unreachable')).toBeDefined()
    })
    expect(screen.getByTestId(`docs-row-${live[0].id}`)).toBeDefined()
  })

  it('degrades a failed listing to fixtures with a partial notice', async () => {
    setBridge(() => Promise.reject(new Error('down')))
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
    setBridge(() => Promise.resolve({ items: [], unreachable: false, signedOut: false }), {
      openExternal
    })
    render(<DocPreview doc={DOC_FIXTURES.drive[1]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(openExternal).toHaveBeenCalledWith(DOC_FIXTURES.drive[1].openUrl)
  })
})
