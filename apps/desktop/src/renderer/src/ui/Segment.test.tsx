import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { SegmentGroup, type SegmentOption } from './Segment'

const segmentCss = readFileSync(
  join(process.cwd(), 'apps/desktop/src/renderer/src/ui/Segment.css'),
  'utf8'
)

afterEach(() => {
  cleanup()
})

const OPTIONS: SegmentOption[] = [
  { value: 'all', icon: 'infinity', label: 'All sources', accent: 'var(--moki-accent-cyan)' },
  { value: 'text', icon: 'messages', label: 'Text', accent: 'var(--moki-accent-mint)' },
  { value: 'email', icon: 'mail', label: 'Email', accent: 'var(--moki-accent-amber)' }
]

function Controlled({ initial = 'all', onChangeProp }: { initial?: string; onChangeProp?: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <SegmentGroup
      label="Sources"
      value={value}
      options={OPTIONS}
      onChange={(v) => {
        setValue(v)
        onChangeProp?.(v)
      }}
    />
  )
}

describe('SegmentGroup', () => {
  it('marks the selected segment lit and the rest idle', () => {
    render(<SegmentGroup label="Sources" value="text" options={OPTIONS} onChange={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: 'Sources' })
    expect(group).toBeDefined()

    const selected = screen.getByRole('radio', { name: 'Text' })
    expect(selected.getAttribute('aria-checked')).toBe('true')
    expect(selected.classList.contains('selected-lit')).toBe(true)

    const idle = screen.getByRole('radio', { name: 'Email' })
    expect(idle.getAttribute('aria-checked')).toBe('false')
    expect(idle.classList.contains('selected-lit')).toBe(false)
  })

  it('reports selection through onChange and moves the lit state', () => {
    const onChange = vi.fn()
    render(<Controlled onChangeProp={onChange} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Email' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('email')

    expect(screen.getByRole('radio', { name: 'Email' }).classList.contains('selected-lit')).toBe(true)
    expect(screen.getByRole('radio', { name: 'All sources' }).classList.contains('selected-lit')).toBe(false)
  })

  it('roves tabindex so only the selected segment is tabbable', () => {
    render(<SegmentGroup label="Sources" value="text" options={OPTIONS} onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Text' }).tabIndex).toBe(0)
    expect(screen.getByRole('radio', { name: 'All sources' }).tabIndex).toBe(-1)
    expect(screen.getByRole('radio', { name: 'Email' }).tabIndex).toBe(-1)
  })

  it('moves selection and focus with ArrowRight and ArrowLeft', () => {
    const onChange = vi.fn()
    render(<Controlled initial="all" onChangeProp={onChange} />)

    const first = screen.getByRole('radio', { name: 'All sources' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('text')

    const second = screen.getByRole('radio', { name: 'Text' })
    expect(second.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(second)
    expect(second.tabIndex).toBe(0)
    expect(screen.getByRole('radio', { name: 'All sources' }).tabIndex).toBe(-1)

    fireEvent.keyDown(second, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('all')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'All sources' }))
  })

  it('jumps with Home and End and wraps past the ends', () => {
    const onChange = vi.fn()
    render(<Controlled initial="text" onChangeProp={onChange} />)

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Text' }), { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('email')

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Email' }), { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('all')

    fireEvent.keyDown(screen.getByRole('radio', { name: 'All sources' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('email')
  })

  it('keeps a selected-lit override that beats the base segment styles', () => {
    const rule = segmentCss.match(/\.moki-segment\.selected-lit\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    for (const token of ['--moki-selection-fill', '--moki-selection-edge', '--moki-selection-shadow']) {
      expect(rule?.[1]).toContain(`var(${token})`)
    }
  })
})
