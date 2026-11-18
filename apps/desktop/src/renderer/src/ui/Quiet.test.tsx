import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QuietButton } from './QuietButton'
import { QuietState } from './QuietState'

afterEach(() => {
  cleanup()
})

describe('QuietButton', () => {
  it('renders a native retry button that reports clicks', () => {
    const onClick = vi.fn()
    render(<QuietButton onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Retry' })
    expect(button.tagName).toBe('BUTTON')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('QuietState', () => {
  it('renders an icon, one line, and an optional action', () => {
    const onRetry = vi.fn()
    render(
      <QuietState
        icon="mail"
        text="Couldn't load the inbox"
        label="Couldn't load the inbox"
        alert
        action={<QuietButton onClick={onRetry}>Retry</QuietButton>}
      />
    )
    const status = screen.getByRole('alert', { name: "Couldn't load the inbox" })
    expect(status.textContent).toContain("Couldn't load the inbox")
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('uses a status role by default', () => {
    render(<QuietState icon="mail" text="Inbox is clear" label="Inbox is clear" />)
    expect(screen.getByRole('status', { name: 'Inbox is clear' })).toBeDefined()
  })
})
