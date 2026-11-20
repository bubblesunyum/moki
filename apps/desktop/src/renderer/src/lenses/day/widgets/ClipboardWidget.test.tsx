import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ClipboardWidget, CLIPBOARD_STORAGE_KEY, type ClipboardEntry } from './ClipboardWidget'

function seed(entries: ClipboardEntry[]): void {
  window.localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify({ entries }))
}

const ENTRIES: ClipboardEntry[] = [
  { id: 'a', text: 'pinned alpha', isPinned: true, copiedAt: 1 },
  { id: 'b', text: 'recent beta', isPinned: false, copiedAt: 2 }
]

afterEach(() => cleanup())
beforeEach(() => window.localStorage.clear())

describe('ClipboardWidget', () => {
  it('shows the quiet empty state with no entries', () => {
    render(<ClipboardWidget />)
    expect(screen.getByRole('status', { name: 'Empty clipboard' })).toBeDefined()
    expect(screen.getByText('No clipboard history yet')).toBeDefined()
  })

  it('renders pinned and recent sections', () => {
    seed(ENTRIES)
    render(<ClipboardWidget />)
    expect(screen.getByText('Pinned')).toBeDefined()
    expect(screen.getByText('Recent')).toBeDefined()
    expect(screen.getByText('pinned alpha')).toBeDefined()
    expect(screen.getByText('recent beta')).toBeDefined()
  })

  it('filters over text and shows the no-match state', () => {
    seed(ENTRIES)
    render(<ClipboardWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Search clipboard' }))
    fireEvent.change(screen.getByLabelText('Filter clipboard'), { target: { value: 'zzz' } })
    expect(screen.getByRole('status', { name: 'No clipboard matches' })).toBeDefined()
    fireEvent.change(screen.getByLabelText('Filter clipboard'), { target: { value: 'beta' } })
    expect(screen.queryByText('pinned alpha')).toBeNull()
    expect(screen.getByText('recent beta')).toBeDefined()
  })

  it('pins an entry and clears recent while keeping pins', () => {
    seed([...ENTRIES, { id: 'c', text: 'recent gamma', isPinned: false, copiedAt: 3 }])
    render(<ClipboardWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Pin recent beta' }))
    const pinned = JSON.parse(window.localStorage.getItem(CLIPBOARD_STORAGE_KEY) ?? '[]')
    expect(pinned).toContainEqual(expect.objectContaining({ id: 'b', isPinned: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear recent' }))
    const stored = JSON.parse(window.localStorage.getItem(CLIPBOARD_STORAGE_KEY) ?? '[]')
    expect(stored).toHaveLength(2)
    expect(stored.every((e: ClipboardEntry) => e.isPinned)).toBe(true)
  })

  it('hides Clear when the filtered view has no recents', () => {
    seed(ENTRIES)
    render(<ClipboardWidget />)
    expect(screen.getByRole('button', { name: 'Clear recent' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Search clipboard' }))
    fireEvent.change(screen.getByLabelText('Filter clipboard'), { target: { value: 'alpha' } })
    expect(screen.getByText('pinned alpha')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Clear recent' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter clipboard'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Clear recent' })).toBeDefined()
  })

  it('keeps the entry text and clears the copied flag after a beat', async () => {
    vi.useFakeTimers()
    try {
      seed(ENTRIES)
      render(<ClipboardWidget />)
      fireEvent.click(screen.getByRole('button', { name: /Copy recent beta/ }))
      await act(async () => {})
      // The text stays — only a transient status appears beside it.
      expect(screen.getByText('recent beta')).toBeDefined()
      expect(screen.getByText('Copied')).toBeDefined()
      act(() => {
        vi.advanceTimersByTime(1600)
      })
      expect(screen.queryByText('Copied')).toBeNull()
      expect(screen.getByText('recent beta')).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops malformed rows without ids', () => {
    window.localStorage.setItem(
      CLIPBOARD_STORAGE_KEY,
      JSON.stringify({ entries: [...ENTRIES, { text: 'no id here' }] })
    )
    render(<ClipboardWidget />)
    expect(screen.getByText('pinned alpha')).toBeDefined()
    expect(screen.getByText('recent beta')).toBeDefined()
    expect(screen.queryByText('no id here')).toBeNull()
  })
})
