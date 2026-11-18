import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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

  it('keeps a selected-lit override that beats the base row styles', () => {
    const rule = rowCss.match(/\.moki-row\.selected-lit\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    for (const token of ['--moki-selection-fill', '--moki-selection-edge', '--moki-selection-shadow']) {
      expect(rule?.[1]).toContain(`var(${token})`)
    }
  })
})
