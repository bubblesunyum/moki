import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DAY_LAYOUT_STORAGE_KEY } from './layout'
import { DayLens } from './DayLens'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  window.localStorage.clear()
})

function widgetOrder(): string[] {
  return screen
    .getAllByTestId(/day-widget-/, { exact: false })
    .map((el) => el.getAttribute('data-testid')?.replace('day-widget-', '') ?? '')
    .filter((id) => id !== '')
}

describe('DayLens', () => {
  it('renders the header, timeline and widget grid', () => {
    render(<DayLens />)
    expect(screen.getByTestId('day-lens')).toBeDefined()
    // Header: today's weekday + live clock region.
    const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' })
    expect(screen.getByRole('heading', { name: new RegExp(weekday) })).toBeDefined()
    // Timeline with the fixture events.
    expect(screen.getByTestId('day-timeline')).toBeDefined()
    for (const title of ['Standup', 'QWELL', 'Lunch', 'Physio', 'Garden']) {
      expect(screen.getByTitle(new RegExp(title))).toBeDefined()
    }
    // Board with the registered sample widgets.
    expect(widgetOrder()).toEqual(['up-next', 'focus'])
  })

  it('drags a widget past its neighbour so the other displaces', () => {
    render(<DayLens />)
    expect(widgetOrder()).toEqual(['up-next', 'focus'])
    const [first, second] = screen.getAllByTestId(/day-widget-/, { exact: false })
    fireEvent.dragStart(first)
    // jsdom rects are zero-sized, so any positive clientX reads as "after".
    fireEvent.dragOver(second, { clientX: 100 })
    fireEvent.drop(second)
    expect(widgetOrder()).toEqual(['focus', 'up-next'])
  })

  it('restores the persisted layout on reload', () => {
    const { unmount } = render(<DayLens />)
    const [first, second] = screen.getAllByTestId(/day-widget-/, { exact: false })
    fireEvent.dragStart(first)
    fireEvent.dragOver(second, { clientX: 100 })
    fireEvent.drop(second)
    expect(widgetOrder()).toEqual(['focus', 'up-next'])
    expect(window.localStorage.getItem(DAY_LAYOUT_STORAGE_KEY)).toContain('focus')

    act(() => {
      unmount()
    })
    render(<DayLens />)
    expect(widgetOrder()).toEqual(['focus', 'up-next'])
  })

  it('resizes a widget with the keyboard handle', () => {
    render(<DayLens />)
    const handle = screen.getByRole('slider', { name: 'Resize Up next' })
    expect(handle.getAttribute('aria-valuenow')).toBe('7')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle.getAttribute('aria-valuenow')).toBe('8')
    expect(screen.getByTestId('day-widget-up-next').style.gridColumn).toBe('span 8')
  })
})
