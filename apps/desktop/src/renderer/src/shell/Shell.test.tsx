import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LENSES } from '../lenses/registry'
import { RpcProvider } from '../rpc'
import { Shell } from './Shell'
import { ShellProvider } from './ShellProvider'

function mockMoki(): void {
  Object.defineProperty(window, 'moki', {
    value: {
      call: () => Promise.resolve({ ok: true, version: 'test' }),
      on: () => () => {},
      openExternal: () => {}
    },
    configurable: true
  })
}

function renderShell(): void {
  render(
    <RpcProvider>
      <ShellProvider>
        <Shell />
      </ShellProvider>
    </RpcProvider>
  )
}

function lensNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Lenses' })
}

beforeEach(() => {
  localStorage.clear()
  mockMoki()
})

afterEach(() => {
  cleanup()
})

describe('Shell', () => {
  it('opens on Messages', () => {
    renderShell()
    const messages = within(lensNav()).getByRole('button', { name: 'Messages' })
    expect(messages.getAttribute('aria-current')).toBe('page')
    expect(messages.classList.contains('selected-lit')).toBe(true)
    expect(screen.getByTestId('messages-list-pane')).toBeDefined()
    expect(screen.getByTestId('messages-thread-pane')).toBeDefined()
  })

  /* title → expected pane testids; null means the `${title} is coming` placeholder.
   * Explicit overrides plus the title-derived default for the mail-bundle lenses. */
  const PANES_BY_TITLE: Record<string, readonly string[]> = {
    Messages: ['messages-list-pane', 'messages-thread-pane'],
    Day: ['day-lens'],
    Docs: ['docs-list-pane', 'docs-preview-pane']
  }
  it.each(
    LENSES.map((lens) => {
      const override = PANES_BY_TITLE[lens.title]
      if (override !== undefined) {
        return { title: lens.title, panes: override }
      }
      if (lens.title === 'Commerce' || lens.title === 'Notifications' || lens.title === 'Feed') {
        const id = lens.title.toLowerCase()
        return { title: lens.title, panes: [`${id}-list-pane`, `${id}-thread-pane`] as const }
      }
      return { title: lens.title, panes: null }
    })
  )('switches to $title and highlights it', ({ title, panes }) => {
    renderShell()
    const row = within(lensNav()).getByRole('button', { name: title })
    fireEvent.click(row)

    expect(row.getAttribute('aria-current')).toBe('page')
    expect(row.classList.contains('selected-lit')).toBe(true)

    if (panes === null) {
      expect(within(screen.getByTestId('shell-content')).getByText(`${title} is coming`)).toBeDefined()
    } else {
      for (const testId of panes) expect(screen.getByTestId(testId)).toBeDefined()
    }
  })

  it('clears the previous highlight when switching lenses', () => {
    renderShell()
    fireEvent.click(within(lensNav()).getByRole('button', { name: 'Day' }))
    expect(
      within(lensNav()).getByRole('button', { name: 'Messages' }).getAttribute('aria-current')
    ).toBeNull()
  })

  it('collapses the sidebar and inspector with the toggles', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(document.querySelector('.moki-sidebar--collapsed')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse inspector' }))
    expect(document.querySelector('.moki-inspector--collapsed')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Expand inspector' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(document.querySelector('.moki-sidebar--collapsed')).toBeNull()
  })

  it('keeps a drag region in both sidebar states', () => {
    renderShell()
    expect(document.querySelector('[data-testid="sidebar-drag"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(document.querySelector('[data-testid="sidebar-drag"]')).not.toBeNull()
  })

  it('renders Back/Forward disabled until navigation exists', () => {
    renderShell()
    for (const name of ['Back', 'Forward'] as const) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(button.disabled).toBe(true)
    }
  })

  it('persists toggle state to localStorage', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Collapse inspector' }))
    expect(localStorage.getItem('moki.shell.sidebarOpen')).toBe('false')
    expect(localStorage.getItem('moki.shell.inspectorOpen')).toBe('false')

    cleanup()
    renderShell()
    expect(document.querySelector('.moki-sidebar--collapsed')).not.toBeNull()
    expect(document.querySelector('.moki-inspector--collapsed')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(localStorage.getItem('moki.shell.sidebarOpen')).toBe('true')
  })

  it('opens the dev Primitives page from the sidebar entry and Cmd+Shift+P', () => {
    renderShell()
    fireEvent.click(screen.getByRole('button', { name: 'Primitives' }))
    expect(within(screen.getByTestId('shell-content')).getByText('Primitives')).toBeDefined()

    fireEvent.keyDown(window, { key: 'P', metaKey: true, shiftKey: true })
    expect(screen.getByTestId('messages-list-pane')).toBeDefined()
  })
})
