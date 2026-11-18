import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Row } from './Row'

const rowCss = readFileSync(join(process.cwd(), 'apps/desktop/src/renderer/src/ui/Row.css'), 'utf8')

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

  it('keeps a selected-lit override that beats the base row styles', () => {
    const rule = rowCss.match(/\.moki-row\.selected-lit\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    for (const token of ['--moki-selection-fill', '--moki-selection-edge', '--moki-selection-shadow']) {
      expect(rule?.[1]).toContain(`var(${token})`)
    }
  })
})
