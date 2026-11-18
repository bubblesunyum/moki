import type { ThreadSummary } from '../../../../../../../packages/protocol/src/index'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { formatRelativeTime } from './formatRelativeTime'
import { MessageRow } from './MessageRow'

const rowCss = readFileSync(
  join(process.cwd(), 'apps/desktop/src/renderer/src/ui/Row.css'),
  'utf8'
)
const messageRowCss = readFileSync(
  join(process.cwd(), 'apps/desktop/src/renderer/src/lenses/messages/MessageRow.css'),
  'utf8'
)

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
    expect(row.textContent).toContain(formatRelativeTime(thread().date))
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
    // Full-row hit area: the button itself spans the row width.
    expect(rowCss).toMatch(/button\.moki-row\s*\{[^}]*width:\s*100%/)
  })

  it('shows a token-based focus ring for keyboard users', () => {
    expect(messageRowCss).toMatch(/\.moki-message-row:focus-visible\s*\{[^}]*var\(--moki-accent-cyan\)/)
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
