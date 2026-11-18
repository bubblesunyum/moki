import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MessagesToolbar } from './MessagesToolbar'

const toolbarCss = readFileSync(
  join(process.cwd(), 'apps/desktop/src/renderer/src/lenses/messages/MessagesToolbar.css'),
  'utf8'
)

afterEach(() => {
  cleanup()
})

describe('MessagesToolbar', () => {
  it('keeps search inert until search exists', () => {
    render(<MessagesToolbar source="email" onChange={() => {}} />)
    const search = screen.getByRole('button', { name: 'Search messages' })
    expect(search.getAttribute('aria-disabled')).toBe('true')
    // The spacer span is gone: the button pushes itself right.
    expect(document.querySelector('.moki-messages-toolbar-spacer')).toBeNull()
    expect(search.classList.contains('moki-messages-toolbar-search')).toBe(true)
  })

  it('draws the hairline from the divider token', () => {
    expect(toolbarCss).toContain('var(--moki-divider-line)')
    expect(toolbarCss).not.toMatch(/rgba\(/)
  })
})
