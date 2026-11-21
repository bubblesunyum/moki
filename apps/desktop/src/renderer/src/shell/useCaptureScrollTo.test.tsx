import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useCaptureScrollTo } from './useCaptureScrollTo'

/* Dev-only capture override under test: ?mokiScrollTo=<test id> polls for
 * the element and keeps it pinned into view; no param, no interval. jsdom
 * has no scrollIntoView, so the test stubs it and counts calls. */

function Harness({ children }: { children?: React.ReactNode }): React.JSX.Element {
  useCaptureScrollTo()
  return <div>{children}</div>
}

describe('useCaptureScrollTo', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    Element.prototype.scrollIntoView = scrollIntoView
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    window.history.replaceState({}, '', '/')
    vi.restoreAllMocks()
  })

  it('scrolls a late-arriving test id into view and keeps it pinned', () => {
    window.history.replaceState({}, '', '/?mokiScrollTo=docs-section-craft')
    const { rerender } = render(<Harness />)

    // Nothing carries the id yet: the interval runs, finds nothing.
    act(() => {
      vi.advanceTimersByTime(1200)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()

    // The section lands (rows resolve, sections mount): scroll starts and
    // re-fires as content above it keeps shifting.
    rerender(
      <Harness>
        <section data-testid="docs-section-craft" />
      </Harness>
    )
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('docs-section-craft').scrollIntoView).toBe(scrollIntoView)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'start' })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(scrollIntoView).toHaveBeenCalledTimes(3)
  })

  it('does nothing without the override', () => {
    render(<Harness />)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('ignores a value that is not a test id and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    window.history.replaceState({}, '', `/?mokiScrollTo=${encodeURIComponent('"not an id"')}`)
    render(<Harness />)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('[capture]')
  })
})
