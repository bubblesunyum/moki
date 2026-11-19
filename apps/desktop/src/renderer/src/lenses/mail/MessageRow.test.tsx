import type { ThreadSummary } from '../../../../../../../packages/protocol/src/index'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { formatListDate } from './formatListDate'
import { MessageRow } from './MessageRow'

afterEach(() => {
  cleanup()
})

function thread(overrides?: Partial<ThreadSummary>): ThreadSummary {
  return {
    id: 'f1',
    account: 'bubbles@example.com',
    from: { name: 'Clayton Gibson', address: 'clayton@example.com' },
    subject: 'Plant swap this weekend?',
    snippet: "Still good for Saturday? I'll bring the monstera cuttings…",
    date: new Date(Date.now() - 24 * 60_000).toISOString(),
    unread: true,
    messageCount: 1,
    labelIds: ['INBOX', 'UNREAD'],
    ...overrides
  }
}

function renderRow(props?: {
  overrides?: Partial<ThreadSummary>
  selected?: boolean
}): { onSelect: ReturnType<typeof vi.fn> } {
  const onSelect = vi.fn()
  render(
    <MessageRow thread={thread(props?.overrides)} selected={props?.selected ?? false} onSelect={onSelect} />
  )
  return { onSelect }
}

describe('MessageRow', () => {
  it('renders the Figma row anatomy from fixture data', () => {
    renderRow()
    const row = screen.getByRole('button', { name: /Clayton Gibson/ })
    expect(row.textContent).toContain('Clayton Gibson')
    expect(row.textContent).toContain('Plant swap this weekend?')
    expect(row.textContent).toContain(formatListDate(thread().date))
    // Amber email badge on the avatar.
    expect(screen.getByRole('img', { name: 'Email' })).toBeDefined()
  })

  it('renders the unread name bolder', () => {
    renderRow()
    const name = screen.getByText('Clayton Gibson')
    expect(name.classList.contains('lens-control-selected')).toBe(true)

    cleanup()
    renderRow({ overrides: { unread: false, labelIds: ['INBOX'] } })
    expect(screen.getByText('Clayton Gibson').classList.contains('lens-control-selected')).toBe(false)
  })

  it.each([
    {
      unread: true,
      selected: false,
      titleClass: 'lens-control-selected',
      tone: 'tone-ink'
    },
    {
      unread: true,
      selected: true,
      titleClass: 'lens-control-selected',
      tone: 'tone-white'
    },
    { unread: false, selected: false, titleClass: 'lens-control', tone: 'tone-muted' },
    { unread: false, selected: true, titleClass: 'lens-control', tone: 'tone-muted' }
  ])(
    'maps read state to title/preview tones (unread=$unread selected=$selected)',
    ({ unread, selected, titleClass, tone }) => {
      cleanup()
      renderRow({ overrides: { unread, labelIds: unread ? ['INBOX', 'UNREAD'] : ['INBOX'] }, selected })
      const name = screen.getByText('Clayton Gibson')
      expect(name.classList.contains(titleClass)).toBe(true)
      expect(name.classList.contains(tone)).toBe(true)
      const preview = screen.getByText('Plant swap this weekend?')
      expect(preview.classList.contains('lens-text')).toBe(true)
      expect(preview.classList.contains(tone)).toBe(true)
    }
  )

  it('shows the avatar indicator dot only for unread threads', () => {
    renderRow()
    expect(
      screen.getByRole('button', { name: /Clayton Gibson/ }).querySelector('.moki-avatar-indicator')
    ).not.toBeNull()

    cleanup()
    renderRow({ overrides: { unread: false, labelIds: ['INBOX'] } })
    expect(
      screen.getByRole('button', { name: /Clayton Gibson/ }).querySelector('.moki-avatar-indicator')
    ).toBeNull()
  })

  it('keeps the indicator dot decorative while exposing unread in the row name', () => {
    renderRow()
    const unreadRow = screen.getByRole('button', { name: /Clayton Gibson/ })
    expect(unreadRow.getAttribute('aria-label')).toMatch(/^Unread: Clayton Gibson — /)
    expect(unreadRow.querySelector('.moki-avatar-indicator')?.getAttribute('aria-hidden')).toBe(
      'true'
    )

    cleanup()
    renderRow({ overrides: { unread: false, labelIds: ['INBOX'] } })
    const readRow = screen.getByRole('button', { name: /Clayton Gibson/ })
    expect(readRow.getAttribute('aria-label')).not.toMatch(/^Unread:/)
    expect(readRow.getAttribute('aria-label')).toContain('Clayton Gibson')
  })

  it('falls back to the snippet when the subject is empty', () => {
    renderRow({ overrides: { subject: '   ' } })
    expect(screen.getByText(/Still good for Saturday/).textContent).toContain(
      "Still good for Saturday? I'll bring the monstera cuttings…"
    )
  })

  it('renders a native button with the full row as its hit area', () => {
    renderRow()
    const row = screen.getByRole('button', { name: /Clayton Gibson/ })
    expect(row.tagName).toBe('BUTTON')
  })

  it('highlights the selected row and reports clicks', () => {
    const { onSelect } = renderRow()
    const row = screen.getByRole('button', { name: /Clayton Gibson/ })
    expect(row.classList.contains('selected-lit')).toBe(false)

    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith({ account: 'bubbles@example.com', id: 'f1' })

    cleanup()
    renderRow({ selected: true })
    expect(screen.getByRole('button', { name: /Clayton Gibson/ }).classList.contains('selected-lit')).toBe(
      true
    )
  })
})
