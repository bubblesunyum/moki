import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Row } from './Row'

afterEach(() => {
  cleanup()
})

describe('Row', () => {
  it('applies the shared selected-lit style when selected', () => {
    const { rerender } = render(<Row title="Mom" />)
    expect(screen.getByText('Mom').closest('.moki-row')?.classList.contains('selected-lit')).toBe(false)

    rerender(<Row title="Mom" selected />)
    expect(screen.getByText('Mom').closest('.moki-row')?.classList.contains('selected-lit')).toBe(true)
  })

  it('renders a native button when as="button"', () => {
    const onClick = vi.fn()
    render(
      <Row as="button" title="Mom" onClick={onClick} />
    )
    const button = screen.getByRole('button', { name: 'Mom' })
    expect(button.tagName).toBe('BUTTON')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('defaults the title to control/ink (white when selected)', () => {
    const { unmount } = render(<Row title="Mom" />)
    const title = screen.getByText('Mom')
    expect(title.classList.contains('lens-control')).toBe(true)
    expect(title.classList.contains('tone-ink')).toBe(true)
    unmount()
    cleanup()

    render(<Row title="Mom" selected />)
    const selectedTitle = screen.getByText('Mom')
    expect(selectedTitle.classList.contains('lens-control')).toBe(true)
    expect(selectedTitle.classList.contains('tone-white')).toBe(true)
  })

  it('lets callers override the title variant/tone and preview tone', () => {
    render(
      <Row
        title="Mom"
        titleVariant="control-selected"
        titleTone="muted"
        preview="hello"
        previewTone="muted"
      />
    )
    const title = screen.getByText('Mom')
    expect(title.classList.contains('lens-control-selected')).toBe(true)
    expect(title.classList.contains('tone-muted')).toBe(true)
    const preview = screen.getByText('hello')
    expect(preview.classList.contains('lens-text')).toBe(true)
    expect(preview.classList.contains('tone-muted')).toBe(true)
  })
})
