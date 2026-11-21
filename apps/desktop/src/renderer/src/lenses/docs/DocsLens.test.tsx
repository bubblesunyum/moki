import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import type { DocItem, DocSource } from '../../../../../../../packages/protocol/src/index'
import { RpcProvider } from '../../rpc/provider'
import { DOC_FIXTURES } from './fixtures'
import { DocsLens } from './DocsLens'
import { DocPreview } from './DocPreview'
import { isWarmHopOrigin } from './warmHop'

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
  it('carries 12 rows per source with contract-shaped open targets', () => {
    for (const source of ['drive', 'notion', 'craft'] as const) {
      const items = DOC_FIXTURES[source]
      expect(items).toHaveLength(12)
      for (const item of items) {
        expect(item.source).toBe(source)
        expect(item.openUrl).toMatch(/^https:\/\//)
        if (source === 'craft') {
          // Craft previews at its web editor and keeps a native-app deepLink.
          expect(item.openUrl).toMatch(/^https:\/\/docs\.craft\.do\/editor\/d\/fixture-space\//)
          expect(item.deepLink).toMatch(/^craftdocs:\/\/open\?/)
        }
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
   * DocsRecentsTests.swift) — Craft rows carry a docs.craft.do editor URL
   * plus a craftdocs deepLink, pinned just below. TS and Swift cannot share one fixture file, so
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
        ['s/launch-checklist-a1b2c3', 'Launch checklist', 'https://docs.craft.do/editor/d/fixture-space/A7C5E2D4-93B1-4F0E-9F27-F1B2C3D4E5F6'],
        ['s/essay-draft-d4e5f6', 'Essay draft', 'https://docs.craft.do/editor/d/fixture-space/4b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e'],
        ['s/trip-itinerary-g7h8i9', 'Trip itinerary', 'https://docs.craft.do/editor/d/fixture-space/B3A4F5E6-D7C8-4A9B-8C0D-1E2F3A4B5C6D'],
        ['s/reading-notes-j0k1l2', 'Reading notes', 'https://docs.craft.do/editor/d/fixture-space/7d8e9f0a-1b2c-4d3e-9f0a-1b2c3d4e5f6a'],
        ['s/garden-plan-m3n4o5', 'Garden plan', 'https://docs.craft.do/editor/d/fixture-space/C9D8E7F6-A5B4-4C3D-8E9F-0A1B2C3D4E5F'],
        ['s/talk-outline-p6q7r8', 'Talk outline', 'https://docs.craft.do/editor/d/fixture-space/2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d'],
        ['s/budget-review-s9t0u1', 'Budget review', 'https://docs.craft.do/editor/d/fixture-space/D0E1F2A3-B4C5-4D6E-8F90-1A2B3C4D5E6F'],
        ['s/book-club-v2w3x4', 'Book club picks', 'https://docs.craft.do/editor/d/fixture-space/5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c'],
        ['s/workout-log-y5z6a7', 'Workout log', 'https://docs.craft.do/editor/d/fixture-space/E1F2A3B4-C5D6-4E7F-8A9B-0C1D2E3F4A5B'],
        ['s/gift-list-b8c9d0', 'Gift list', 'https://docs.craft.do/editor/d/fixture-space/6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d'],
        ['s/home-inventory-e1f2g3', 'Home inventory', 'https://docs.craft.do/editor/d/fixture-space/F2A3B4C5-D6E7-4F8A-9B0C-1D2E3F4A5B6C'],
        ['s/ideas-inbox-h4i5j6', 'Ideas inbox', 'https://docs.craft.do/editor/d/fixture-space/3b4c5d6e-7f8a-4b9c-0d1e-2f3a4b5c6d7e']
      ]
    }
    for (const source of ['drive', 'notion', 'craft'] as const) {
      const items = DOC_FIXTURES[source]
      expect(items.map((item) => [item.id, item.title, item.openUrl])).toEqual(canonical[source])
      if (source === 'craft') {
        // Craft previews at its web editor built from the clickableLink
        // values (editor ids, not row ids) and keeps a native-app deepLink
        // mirroring the helper's DocsFixtures shape.
        const craftEditorIds: Record<string, string> = {
          's/launch-checklist-a1b2c3': 'A7C5E2D4-93B1-4F0E-9F27-F1B2C3D4E5F6',
          's/essay-draft-d4e5f6': '4b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
          's/trip-itinerary-g7h8i9': 'B3A4F5E6-D7C8-4A9B-8C0D-1E2F3A4B5C6D',
          's/reading-notes-j0k1l2': '7d8e9f0a-1b2c-4d3e-9f0a-1b2c3d4e5f6a',
          's/garden-plan-m3n4o5': 'C9D8E7F6-A5B4-4C3D-8E9F-0A1B2C3D4E5F',
          's/talk-outline-p6q7r8': '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
          's/budget-review-s9t0u1': 'D0E1F2A3-B4C5-4D6E-8F90-1A2B3C4D5E6F',
          's/book-club-v2w3x4': '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c',
          's/workout-log-y5z6a7': 'E1F2A3B4-C5D6-4E7F-8A9B-0C1D2E3F4A5B',
          's/gift-list-b8c9d0': '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d',
          's/home-inventory-e1f2g3': 'F2A3B4C5-D6E7-4F8A-9B0C-1D2E3F4A5B6C',
          's/ideas-inbox-h4i5j6': '3b4c5d6e-7f8a-4b9c-0d1e-2f3a4b5c6d7e'
        }
        expect(items.map((item) => item.deepLink)).toEqual(
          items.map((item) => `craftdocs://open?spaceId=fixture-space&documentId=${craftEditorIds[item.id]}`)
        )
      } else {
        for (const item of items) expect(item.deepLink).toBeUndefined()
      }
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

  it('clicking a Craft row previews its web editor like a Notion row', () => {
    renderLens()
    const target = DOC_FIXTURES.craft[2]
    fireEvent.click(screen.getByTestId(`docs-row-${target.id}`))
    expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(target.openUrl)
    expect(screen.getByTestId(`docs-row-${target.id}`).getAttribute('aria-current')).toBe('true')
  })

  it('switching drive rows loads the picked file', async () => {
    // Drive file views never route a synthetic popstate (mok-tlq): a
    // same-section pick must commit src as a real load, not hop in-page.
    renderLens()
    const second = DOC_FIXTURES.drive[1]
    // drive[0] is auto-selected.
    const frame = screen.getByTestId('docs-preview-frame')
    const run = vi.fn().mockResolvedValue(undefined)
    ;(frame as unknown as Record<string, unknown>).executeJavaScript = run
    fireEvent(frame, new CustomEvent('dom-ready'))
    fireEvent.click(screen.getByTestId(`docs-row-${second.id}`))
    await waitFor(() => {
      expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(second.openUrl)
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('craft-to-craft picks keep one warm guest with src frozen', async () => {
    renderLens()
    const first = DOC_FIXTURES.craft[0]
    const second = DOC_FIXTURES.craft[1]
    // Drive is auto-selected, so the first craft pick is a cross-app
    // remount: a fresh guest mounts on the picked editor URL.
    fireEvent.click(screen.getByTestId(`docs-row-${first.id}`))
    const frame = screen.getByTestId('docs-preview-frame')
    expect(frame.getAttribute('src')).toBe(first.openUrl)
    const run = vi.fn().mockResolvedValue(undefined)
    ;(frame as unknown as Record<string, unknown>).executeJavaScript = run
    fireEvent(frame, new CustomEvent('dom-ready'))
    // The second craft doc arrives inside the same running app: the guest
    // element is reused, the pane never re-loadURLs (src frozen), and the
    // new doc is an in-page hop through the guest's script engine.
    fireEvent.click(screen.getByTestId(`docs-row-${second.id}`))
    const kept = screen.getByTestId('docs-preview-frame')
    expect(kept).toBe(frame)
    expect(kept.getAttribute('src')).toBe(first.openUrl)
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect((run.mock.calls[0][0] as string)).toContain(JSON.stringify(second.openUrl))
  })

  it('a single selection replaces the pane', () => {
    renderLens()
    const first = DOC_FIXTURES.drive[0]
    const other = DOC_FIXTURES.notion[5]
    expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(first.openUrl)
    fireEvent.click(screen.getByTestId(`docs-row-${other.id}`))
    expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(other.openUrl)
    expect(screen.getByTestId(`docs-row-${other.id}`).getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId(`docs-row-${first.id}`).getAttribute('aria-current')).toBe('false')
  })

  it('preselects ?mokiDoc= for captures', () => {
    const target = DOC_FIXTURES.notion[2]
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

  it('a failed listing renders empty rows with a quiet notice', async () => {
    setBridge(() => Promise.reject(new Error('down')))
    renderLens()
    await waitFor(() => {
      expect(screen.getAllByText("Couldn't refresh")).toHaveLength(3)
    })
    // Honesty: no fixture rows posing as the user's docs.
    expect(document.querySelectorAll('[data-testid^="docs-row-"]')).toHaveLength(0)
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

  it('shows a quiet loading state until the guest signals ready', () => {
    // jsdom has no real webview: the hook's listeners are real DOM
    // listeners, so dispatching dom-ready on the bound element is the
    // guest's first-paint signal.
    render(<DocPreview doc={DOC_FIXTURES.drive[1]} />)
    expect(screen.getByTestId('docs-preview-loading')).toBeDefined()
    fireEvent(screen.getByTestId('docs-preview-frame'), new CustomEvent('dom-ready'))
    expect(screen.queryByTestId('docs-preview-loading')).toBeNull()
  })

  it('raises the loading state again on a new pick', () => {
    const { rerender } = render(<DocPreview doc={DOC_FIXTURES.drive[1]} />)
    fireEvent(screen.getByTestId('docs-preview-frame'), new CustomEvent('dom-ready'))
    expect(screen.queryByTestId('docs-preview-loading')).toBeNull()
    rerender(<DocPreview doc={DOC_FIXTURES.notion[2]} />)
    expect(screen.getByTestId('docs-preview-loading')).toBeDefined()
  })

  it('raises the loading state again when a peek expands into the pane', () => {
    // The popup route needs a real `on` subscription: main denied the
    // native window and forwarded the URL over `web.popup`.
    let popupHandler: ((params: unknown) => void) | null = null
    ;(window as unknown as { moki: unknown }).moki = {
      call: () => Promise.resolve({ ok: true }),
      on: (event: string, cb: (params: unknown) => void) => {
        if (event === 'web.popup') popupHandler = cb
        return () => {}
      },
      openExternal: vi.fn().mockResolvedValue(undefined)
    }
    render(<DocPreview doc={DOC_FIXTURES.drive[1]} />)
    fireEvent(screen.getByTestId('docs-preview-frame'), new CustomEvent('dom-ready'))
    expect(screen.queryByTestId('docs-preview-loading')).toBeNull()
    act(() => {
      popupHandler?.({ url: 'https://example.com/peeked' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open in tile' }))
    // Expand remounts the guest on the peeked URL — the overlay covers the
    // swap until the new page's first dom-ready, same as a pick.
    expect(screen.getByTestId('docs-preview-loading')).toBeDefined()
  })

  /* Warm app switching (mok-ic6): same-origin picks keep the live guest —
   * the pane's src stays frozen and the guest hops in-page — while a
   * cross-origin pick remounts fresh. Since mok-tlq the hop is gated on
   * WARM_HOP_ORIGINS: only apps verified to service a synthetic popstate
   * hop, every other same-origin pick commits src as a real load. jsdom
   * has no real webview, so the hop's executeJavaScript is a mock on the
   * bound element and the guest's navigation events are dispatched the
   * same way dom-ready is. */
  function mockHop(frame: Element): ReturnType<typeof vi.fn> {
    const run = vi.fn().mockResolvedValue(undefined)
    ;(frame as unknown as Record<string, unknown>).executeJavaScript = run
    return run
  }

  function guestInPage(url: string): Event {
    const ev = new Event('did-navigate-in-page') as Event & { url?: string }
    ev.url = url
    return ev
  }

  it('a same-app pick keeps the live guest and hops in-page with src frozen', async () => {
    const first = DOC_FIXTURES.craft[0]
    const second = DOC_FIXTURES.craft[1]
    const { rerender } = render(<DocPreview doc={first} />)
    const frame = screen.getByTestId('docs-preview-frame')
    expect(frame.getAttribute('src')).toBe(first.openUrl)
    const run = mockHop(frame)
    rerender(<DocPreview doc={second} />)
    // The element itself is reused — identity, not just one frame.
    const kept = screen.getByTestId('docs-preview-frame')
    expect(kept).toBe(frame)
    expect(kept.getAttribute('src')).toBe(first.openUrl)
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    const script = run.mock.calls[0][0] as string
    expect(script).toContain(JSON.stringify(second.openUrl))
  })

  it('a notion pick hops warm with src frozen', async () => {
    // Pins the second allowlist entry: Notion's rows are the only other
    // same-origin pair that must stay warm.
    const first = DOC_FIXTURES.notion[0]
    const second = DOC_FIXTURES.notion[1]
    const { rerender } = render(<DocPreview doc={first} />)
    const frame = screen.getByTestId('docs-preview-frame')
    const run = mockHop(frame)
    rerender(<DocPreview doc={second} />)
    expect(screen.getByTestId('docs-preview-frame')).toBe(frame)
    expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(first.openUrl)
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  })

  it('a drive pick commits src cold even though injection is available', async () => {
    // Same origin, but file views never service a synthetic popstate:
    // no hop is attempted and the pane commits the new src — the guest
    // navigates for real.
    const first = DOC_FIXTURES.drive[0]
    const second = DOC_FIXTURES.drive[1]
    const { rerender } = render(<DocPreview doc={first} />)
    const frame = screen.getByTestId('docs-preview-frame')
    const run = mockHop(frame)
    fireEvent(frame, new CustomEvent('dom-ready'))
    rerender(<DocPreview doc={second} />)
    await waitFor(() => {
      expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(second.openUrl)
    })
    expect(run).not.toHaveBeenCalled()
    // The overlay lifts on the new document's dom-ready, like any cold load.
    expect(screen.getByTestId('docs-preview-loading')).toBeDefined()
    fireEvent(screen.getByTestId('docs-preview-frame'), new CustomEvent('dom-ready'))
    expect(screen.queryByTestId('docs-preview-loading')).toBeNull()
  })

  it('native Google Doc rows switch cold too', async () => {
    // Live Drive rows carry webViewLink when present, so a native doc
    // opens at its docs.google.com editor — a different origin from the
    // drive.google.com file view. Editors never service a popstate
    // either: both same-origin pairs across the Drive section commit
    // src, never hop.
    const first: DocItem = {
      ...DOC_FIXTURES.drive[0],
      openUrl: 'https://docs.google.com/document/d/f1/edit'
    }
    const second: DocItem = {
      ...DOC_FIXTURES.drive[1],
      openUrl: 'https://docs.google.com/document/d/f2/edit'
    }
    const { rerender } = render(<DocPreview doc={first} />)
    const run = mockHop(screen.getByTestId('docs-preview-frame'))
    fireEvent(screen.getByTestId('docs-preview-frame'), new CustomEvent('dom-ready'))
    rerender(<DocPreview doc={second} />)
    await waitFor(() => {
      expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(second.openUrl)
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('reselecting the doc a warm hop left hops back and lifts the overlay', async () => {
    // The strand mok-tlq closed: a warm hop never rewrites the frozen
    // src, so the pane must compare picks against the guest's live URL —
    // reselecting the first doc after a hop to the second must hop back,
    // not strand the overlay over the second doc's painted page.
    const first = DOC_FIXTURES.craft[0]
    const second = DOC_FIXTURES.craft[1]
    const { rerender } = render(<DocPreview doc={first} />)
    const frame = screen.getByTestId('docs-preview-frame')
    const run = mockHop(frame)
    fireEvent(frame, new CustomEvent('dom-ready'))
    rerender(<DocPreview doc={second} />)
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    fireEvent(screen.getByTestId('docs-preview-frame'), guestInPage(second.openUrl))
    expect(screen.queryByTestId('docs-preview-loading')).toBeNull()
    // The guest now sits on the second doc while the frozen src still
    // says the first.
    rerender(<DocPreview doc={first} />)
    expect(screen.getByTestId('docs-preview-loading')).toBeDefined()
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    const script = run.mock.calls[1][0] as string
    expect(script).toContain(JSON.stringify(first.openUrl))
    fireEvent(screen.getByTestId('docs-preview-frame'), guestInPage(first.openUrl))
    expect(screen.queryByTestId('docs-preview-loading')).toBeNull()
  })

  it('never warms the Drive origins or the Craft home', () => {
    // Boundary pin (mok-tlq): docs.google.com looks like "just Drive"
    // but its editor never routes a popstate — warming either Google
    // origin, or the craft-home pick, would strand the pane on the old
    // doc exactly the way the reported bug did.
    for (const url of [
      'https://drive.google.com/file/d/x/view',
      'https://docs.google.com/document/d/x/edit',
      'https://www.craft.do'
    ]) {
      expect(isWarmHopOrigin(url)).toBe(false)
    }
    expect(isWarmHopOrigin('https://docs.craft.do/editor/d/s/d')).toBe(true)
    expect(isWarmHopOrigin('https://www.notion.so/page')).toBe(true)
  })

  it('clears the loading overlay on the in-page event for a same-app pick', () => {
    const first = DOC_FIXTURES.craft[0]
    const second = DOC_FIXTURES.craft[1]
    const { rerender } = render(<DocPreview doc={first} />)
    const frame = screen.getByTestId('docs-preview-frame')
    mockHop(frame)
    fireEvent(frame, new CustomEvent('dom-ready'))
    expect(screen.queryByTestId('docs-preview-loading')).toBeNull()
    rerender(<DocPreview doc={second} />)
    expect(screen.getByTestId('docs-preview-loading')).toBeDefined()
    // dom-ready never fires for an in-page hop — the hop's own
    // navigation event lands on the already-painted app and lifts it.
    fireEvent(screen.getByTestId('docs-preview-frame'), guestInPage(second.openUrl))
    expect(screen.queryByTestId('docs-preview-loading')).toBeNull()
  })

  it('a cross-app pick remounts the guest fresh', () => {
    const { rerender } = render(<DocPreview doc={DOC_FIXTURES.drive[1]} />)
    const frame = screen.getByTestId('docs-preview-frame')
    fireEvent(frame, new CustomEvent('dom-ready'))
    rerender(<DocPreview doc={DOC_FIXTURES.notion[2]} />)
    const fresh = screen.getByTestId('docs-preview-frame')
    expect(fresh).not.toBe(frame)
    expect(fresh.getAttribute('src')).toBe(DOC_FIXTURES.notion[2].openUrl)
    // Same commit: the blank guest and the overlay render together —
    // no white-flash frame with the overlay down.
    expect(screen.getByTestId('docs-preview-loading')).toBeDefined()
  })

  it('a same-id url rotation remounts with the overlay up', () => {
    // A refetch can change a row's openUrl without changing its id — the
    // per-doc reset never fires, so the mount itself must cover the swap.
    const rotated = { ...DOC_FIXTURES.drive[0], openUrl: DOC_FIXTURES.notion[0].openUrl }
    const { rerender } = render(<DocPreview doc={DOC_FIXTURES.drive[0]} />)
    fireEvent(screen.getByTestId('docs-preview-frame'), new CustomEvent('dom-ready'))
    rerender(<DocPreview doc={rotated} />)
    expect(screen.getByTestId('docs-preview-loading')).toBeDefined()
    expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(rotated.openUrl)
  })

  it('an empty-pane interlude never pre-loads the stale doc', () => {
    const first = DOC_FIXTURES.notion[0]
    const second = DOC_FIXTURES.notion[1]
    const { rerender } = render(<DocPreview doc={first} />)
    fireEvent(screen.getByTestId('docs-preview-frame'), new CustomEvent('dom-ready'))
    // The selection vanishing (sign-out, refetch) empties the pane and
    // unmounts the guest — the committed src must not survive it.
    rerender(<DocPreview doc={null} />)
    expect(screen.getByTestId('docs-preview-empty')).toBeDefined()
    rerender(<DocPreview doc={second} />)
    const frame = screen.getByTestId('docs-preview-frame')
    expect(frame.getAttribute('src')).toBe(second.openUrl)
  })

  it('a same-app pick without script injection falls back to a full load', async () => {
    // No executeJavaScript on the jsdom element: the hop rejects like a
    // missing guest and the pane commits src — cold but correct, no crash.
    const first = DOC_FIXTURES.craft[0]
    const second = DOC_FIXTURES.craft[1]
    const { rerender } = render(<DocPreview doc={first} />)
    fireEvent(screen.getByTestId('docs-preview-frame'), new CustomEvent('dom-ready'))
    rerender(<DocPreview doc={second} />)
    await waitFor(() => {
      expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(second.openUrl)
    })
  })

  it('a rejected hop falls back to a full src load', async () => {
    const first = DOC_FIXTURES.craft[0]
    const second = DOC_FIXTURES.craft[1]
    const { rerender } = render(<DocPreview doc={first} />)
    const run = mockHop(screen.getByTestId('docs-preview-frame'))
    run.mockRejectedValueOnce(new Error('injection failed'))
    fireEvent(screen.getByTestId('docs-preview-frame'), new CustomEvent('dom-ready'))
    rerender(<DocPreview doc={second} />)
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe(second.openUrl)
    })
  })
})

/* Signed-out states (mok-8uu.6/12, mok-68k/0xc): every auth state explains
 * itself and offers its real action — Drive and Notion share the
 * browser-approval sign-in control, Craft offers its paste-once Connect
 * form. Empty-unreachable Craft (no credential to fix) keeps Open Craft
 * loading the home page in the preview. */
describe('Docs signed-out states', () => {
  function signedOutBridge(signedOutSource: DocSource): void {
    setBridge((_method, params) => {
      const source = (params as { source: DocSource }).source
      return Promise.resolve({
        items: source === signedOutSource ? [] : DOC_FIXTURES[source],
        unreachable: false,
        signedOut: source === signedOutSource
      })
    })
  }

  it('drive offers a working Google sign-in', async () => {
    signedOutBridge('drive')
    renderLens()
    await waitFor(() => {
      expect(screen.getByLabelText('Drive needs sign-in')).toBeDefined()
    })
    expect(screen.getByText('Connect Drive to list docs')).toBeDefined()
    expect(screen.getByText('Zen import signs in previews, not the list')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeDefined()
    expect(screen.queryByTestId(`docs-row-${DOC_FIXTURES.drive[0].id}`)).toBeNull()
  })

  it('craft signed-out shows the paste form, not the preview home', async () => {
    signedOutBridge('craft')
    renderLens()
    await waitFor(() => {
      expect(screen.getByLabelText('Craft needs sign-in')).toBeDefined()
    })
    expect(screen.getByText('Connect Craft to list docs')).toBeDefined()
    expect(screen.getByLabelText('Craft connection URL')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Validate' })).toBeDefined()
    expect(screen.getByText('Craft → Settings → API → Create connection')).toBeDefined()
    // A credential fix exists — no Open Craft fallback here.
    expect(screen.queryByRole('button', { name: 'Open Craft' })).toBeNull()
    expect(screen.queryByTestId(`docs-row-${DOC_FIXTURES.craft[0].id}`)).toBeNull()
  })

  it('craft unreachable with no rows still opens the home page', async () => {
    setBridge((_method, params) => {
      const source = (params as { source: DocSource }).source
      if (source === 'craft') return Promise.resolve({ items: [], unreachable: true, signedOut: false })
      return Promise.resolve({ items: DOC_FIXTURES[source], unreachable: false, signedOut: false })
    })
    renderLens()
    await waitFor(() => {
      expect(screen.getByText('Craft is unreachable')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open Craft' }))
    expect(screen.getByTestId('docs-preview-frame').getAttribute('src')).toBe('https://www.craft.do')
  })

  it('notion offers browser approval and page selection', async () => {
    signedOutBridge('notion')
    renderLens()
    await waitFor(() => {
      expect(screen.getByLabelText('Notion needs sign-in')).toBeDefined()
    })
    expect(screen.getByRole('button', { name: 'Sign in with Notion' })).toBeDefined()
    expect(screen.getByText(/Choose which pages Moki may list/)).toBeDefined()
    expect(screen.getByText(/stored only in the Mac Keychain/)).toBeDefined()
    expect(screen.queryByLabelText('Notion integration token')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Notion settings' })).toBeNull()
  })
})
