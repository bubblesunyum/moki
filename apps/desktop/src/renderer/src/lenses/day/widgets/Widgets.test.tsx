import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FocusWidget, FOCUS_STORAGE_KEY } from './FocusWidget'
import { UsageWidget } from './UsageWidget'
import { SystemToolsWidget } from './SystemToolsWidget'

afterEach(() => cleanup())
beforeEach(() => window.localStorage.clear())

describe('FocusWidget', () => {
  it('starts, pauses, resumes and resets the timer', () => {
    const { unmount } = render(<FocusWidget />)
    expect(screen.getByTestId('focus-clock').textContent).toBe('25:00')
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }))
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('button', { name: 'Start focus' })).toBeDefined()
    unmount()
  })

  it('skips a focus block into the break and persists the count', () => {
    render(<FocusWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByTestId('focus-clock').textContent).toBe('05:00')
    expect(window.localStorage.getItem(FOCUS_STORAGE_KEY)).toContain('"completedToday":1')
  })

  it('offers the earned break after a skip', () => {
    render(<FocusWidget />)
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }))
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDefined()
    expect(screen.getByTestId('focus-clock').textContent).toBe('05:00')
  })

  it('applies duration settings', () => {
    render(<FocusWidget />)
    fireEvent.change(screen.getByLabelText('Focus minutes'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Break minutes'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start focus' }))
    expect(screen.getByTestId('focus-clock').textContent).toBe('50:00')
  })
})

describe('UsageWidget', () => {
  it('renders the three quota rows and the offline note', () => {
    render(<UsageWidget />)
    expect(screen.getByTestId('usage-widget')).toBeDefined()
    for (const label of ['5-hour', 'Weekly', 'Monthly']) {
      expect(screen.getByText(label)).toBeDefined()
    }
    expect(screen.getAllByRole('progressbar')).toHaveLength(3)
    expect(screen.getByText('Sample data — connect Go with /connect')).toBeDefined()
  })
})

describe('SystemToolsWidget', () => {
  it('renders system rows with expandable detail and the tool grid', () => {
    render(<SystemToolsWidget />)
    for (const label of ['CPU', 'GPU', 'Memory', 'Battery']) {
      expect(screen.getByText(label)).toBeDefined()
    }
    fireEvent.click(screen.getByText('CPU'))
    expect(screen.getByText(/cores/)).toBeDefined()
    expect(screen.getByText('Sample data — live stats coming')).toBeDefined()
    for (const tool of ['Copy Text', 'Focus 25-min', 'Mute', 'Screenshot']) {
      expect(screen.getByRole('button', { name: tool })).toBeDefined()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(screen.getByRole('status', { name: 'Tool notice' })).toBeDefined()
  })
})
