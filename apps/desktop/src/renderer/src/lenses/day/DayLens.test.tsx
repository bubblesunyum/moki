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
  it('renders the range control, hero, timeline and widget grid', () => {
    render(<DayLens />)
    expect(screen.getByTestId('day-lens')).toBeDefined()
    // Range control above the hero.
    expect(screen.getByRole('radiogroup', { name: 'Day range' })).toBeDefined()
    for (const name of ['Today', 'Tomorrow', 'Week']) {
      expect(screen.getByRole('radio', { name })).toBeDefined()
    }
    // Hero: today's weekday + live clock in the ring.
    const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' })
    expect(screen.getByRole('heading', { name: new RegExp(weekday) })).toBeDefined()
    expect(screen.getByTestId('day-hero')).toBeDefined()
    // Timeline with the fixture events.
    expect(screen.getByTestId('day-timeline')).toBeDefined()
    for (const title of ['Standup', 'QWELL', 'Lunch', 'Physio', 'Garden']) {
      expect(screen.getByTitle(new RegExp(title))).toBeDefined()
    }
    // Board with the full widget set; Up next is gone.
    expect(widgetOrder()).toEqual(['focus', 'clipboard', 'files', 'usage', 'system', 'web'])
    expect(screen.queryByTestId('day-widget-up-next')).toBeNull()
  })

  it('switches the header date across the range control', () => {
    render(<DayLens />)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const weekday = tomorrow.toLocaleDateString('en-US', { weekday: 'long' })
    fireEvent.click(screen.getByRole('radio', { name: 'Tomorrow' }))
    expect(screen.getByRole('heading', { name: new RegExp(weekday) })).toBeDefined()
    fireEvent.click(screen.getByRole('radio', { name: 'Week' }))
    expect(screen.getByRole('heading', { name: 'Week' })).toBeDefined()
  })

  it('restores the persisted layout on reload', () => {
    const { unmount } = render(<DayLens />)
    const handle = screen.getByRole('slider', { name: 'Resize Focus' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle.getAttribute('aria-valuenow')).toBe('11')
    expect(window.localStorage.getItem(DAY_LAYOUT_STORAGE_KEY)).toContain('focus')

    act(() => {
      unmount()
    })
    render(<DayLens />)
    expect(widgetOrder()).toEqual(['focus', 'clipboard', 'files', 'usage', 'system', 'web'])
    expect(screen.getByRole('slider', { name: 'Resize Focus' }).getAttribute('aria-valuenow')).toBe('11')
  })

  it('resizes the tile with the keyboard handle', () => {
    render(<DayLens />)
    const handle = screen.getByRole('slider', { name: 'Resize Focus' })
    expect(handle.getAttribute('aria-valuenow')).toBe('12')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle.getAttribute('aria-valuenow')).toBe('11')
    expect(screen.getByTestId('day-widget-focus').style.gridColumn).toBe('span 11')
  })
})
