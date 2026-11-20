import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FilesWidget, FILES_STORAGE_KEY, type FileEntry } from './FilesWidget'

function seed(entries: FileEntry[]): void {
  window.localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify({ entries }))
}

const ENTRIES: FileEntry[] = [
  { id: 'p1', name: 'pinned.txt', isPinned: true, addedAt: 1 },
  { id: 'r1', name: 'https://example.com/report', isPinned: false, addedAt: 2 },
  { id: 'h1', name: '.hidden', isPinned: false, addedAt: 3 }
]

afterEach(() => {
  cleanup()
  delete (window as unknown as { moki?: unknown }).moki
})
beforeEach(() => window.localStorage.clear())

describe('FilesWidget', () => {
  it('shows the drop-target empty state with no entries', () => {
    render(<FilesWidget />)
    expect(screen.getByRole('status', { name: 'Empty files shelf' })).toBeDefined()
  })

  it('renders pinned and recent sections and hides dotfiles by default', () => {
    seed(ENTRIES)
    render(<FilesWidget />)
    expect(screen.getByRole('region', { name: 'Pinned files' })).toBeDefined()
    expect(screen.getByRole('region', { name: 'Recent files' })).toBeDefined()
    expect(screen.queryByText('.hidden')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Files actions' }))
    fireEvent.click(screen.getByLabelText('Show hidden'))
    expect(screen.getByText('.hidden')).toBeDefined()
  })

  it('adds dropped files', () => {
    render(<FilesWidget />)
    fireEvent.drop(screen.getByTestId('files-widget'), {
      dataTransfer: { files: [{ name: 'dropped.pdf' }] }
    })
    expect(screen.getByText('dropped.pdf')).toBeDefined()
  })

  it('opens http entries via the bridge; plain paths render as text', () => {
    const openExternal = vi.fn(async (_url: string) => {})
    ;(window as unknown as { moki?: unknown }).moki = { openExternal }
    seed(ENTRIES)
    render(<FilesWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Open https://example.com/report' }))
    expect(openExternal).toHaveBeenCalledWith('https://example.com/report')
    // Plain paths are not buttons — there is nothing dead to click.
    expect(screen.queryByRole('button', { name: 'Open pinned.txt' })).toBeNull()
    expect(screen.getByText('pinned.txt')).toBeDefined()
    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('pins, removes and clears recent while keeping pins', () => {
    seed([
      { id: 'p1', name: 'pinned.txt', isPinned: true, addedAt: 1 },
      { id: 'r1', name: 'https://example.com/report', isPinned: false, addedAt: 2 },
      { id: 'r2', name: 'notes.md', isPinned: false, addedAt: 3 }
    ])
    render(<FilesWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Pin https://example.com/report' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove pinned.txt' }))
    expect(screen.queryByText('pinned.txt')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Files actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText('notes.md')).toBeNull()
    expect(screen.getByText('https://example.com/report')).toBeDefined()
  })

  it('expands pinned past six behind a toggle', () => {
    seed(
      Array.from({ length: 8 }, (_, i) => ({
        id: `p${i}`,
        name: `pinned-${i}.txt`,
        isPinned: true,
        addedAt: i
      }))
    )
    render(<FilesWidget />)
    expect(screen.getByText('pinned-0.txt')).toBeDefined()
    expect(screen.queryByText('pinned-7.txt')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more pinned files' }))
    expect(screen.getByText('pinned-7.txt')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer pinned files' }))
    expect(screen.queryByText('pinned-7.txt')).toBeNull()
  })
})
