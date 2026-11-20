import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WebViewWidget } from './WebViewWidget'
import {
  WEBVIEW_HOME_DEFAULT,
  WEBVIEW_STORAGE_KEY,
  normalizeAddress
} from './webviewShared'
import { WEBSITES_PARTITION } from '../../../../../../../../packages/protocol/src/index'

afterEach(() => cleanup())
beforeEach(() => window.localStorage.clear())

/* Guest right-clicks arrive over `web.contextMenu` carrying the guest id.
 * The tile only answers for its own guest. */
const toggleHandlers: Array<(params: unknown) => void> = []

function setToggleBridge(): void {
  toggleHandlers.length = 0
  ;(window as unknown as { moki: unknown }).moki = {
    on: (event: string, cb: (...args: never[]) => void) => {
      if (event === 'web.contextMenu') toggleHandlers.push(cb as (params: unknown) => void)
      return () => {}
    }
  }
}

function fireGuestRightClick(guestId: number): void {
  act(() => {
    for (const cb of toggleHandlers) cb({ guestId })
  })
}

/* The tile identifies its guest through the webview element. jsdom has no
 * guest, so tests pin the id on the frame the way Electron would. */
function pinGuestId(id: number): void {
  const frame = screen.getByTestId('day-webview-frame') as HTMLElement & { getWebContentsId?: () => number }
  frame.getWebContentsId = () => id
}

/* The pill is hidden until right-click: tests that drive the address bar
 * open it first, like a user would. */
function showChrome(): void {
  fireEvent.contextMenu(screen.getByTestId('day-webview'))
}

describe('normalizeAddress', () => {
  it('passes http and https URLs through as typed', () => {
    expect(normalizeAddress('https://example.com/docs')).toBe('https://example.com/docs')
    expect(normalizeAddress('http://example.com')).toBe('http://example.com')
  })

  it('gives a bare host the https scheme', () => {
    expect(normalizeAddress('example.com')).toBe('https://example.com')
    expect(normalizeAddress('  example.com/path  ')).toBe('https://example.com/path')
  })

  it('rejects dangerous schemes', () => {
    expect(normalizeAddress('javascript:alert(1)')).toBeNull()
    expect(normalizeAddress('data:text/html,<h1>x</h1>')).toBeNull()
    expect(normalizeAddress('file:///etc/passwd')).toBeNull()
    expect(normalizeAddress('ftp://example.com')).toBeNull()
  })

  it('rejects scheme-relative, backslash, credentialed and spaced input', () => {
    expect(normalizeAddress('//example.com')).toBeNull()
    expect(normalizeAddress('example\\com')).toBeNull()
    expect(normalizeAddress('https://user:pass@example.com')).toBeNull()
    expect(normalizeAddress('https://user@example.com')).toBeNull()
    expect(normalizeAddress('exa mple.com')).toBeNull()
    expect(normalizeAddress('')).toBeNull()
  })
})

describe('WebViewWidget', () => {
  it('renders the persisted home and lands the sandbox attributes', () => {
    window.localStorage.setItem(WEBVIEW_STORAGE_KEY, JSON.stringify('https://example.com/inbox'))
    render(<WebViewWidget />)
    showChrome()
    expect((screen.getByLabelText('Web address') as HTMLInputElement).value).toBe(
      'https://example.com/inbox'
    )
    const frame = screen.getByTestId('day-webview-frame')
    expect(frame.getAttribute('src')).toBe('https://example.com/inbox')
    expect(frame.getAttribute('partition')).toBe(WEBSITES_PARTITION)
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('allowpopups')).toBe('')
  })

  it('falls back to the default home with nothing stored', () => {
    render(<WebViewWidget />)
    showChrome()
    expect((screen.getByLabelText('Web address') as HTMLInputElement).value).toBe(WEBVIEW_HOME_DEFAULT)
  })

  it('navigates on submit and persists the normalized address', () => {
    const { container } = render(<WebViewWidget />)
    showChrome()
    const form = container.querySelector('.moki-day-webview-address')
    expect(form).not.toBeNull()
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'example.org/docs' } })
    fireEvent.submit(form!)
    expect(screen.getByTestId('day-webview-frame').getAttribute('src')).toBe('https://example.org/docs')
    expect(JSON.parse(window.localStorage.getItem(WEBVIEW_STORAGE_KEY) ?? 'null')).toBe(
      'https://example.org/docs'
    )
  })

  it('rejects bad addresses without leaving home', () => {
    const { container } = render(<WebViewWidget />)
    showChrome()
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.submit(container.querySelector('.moki-day-webview-address')!)
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByTestId('day-webview-frame').getAttribute('src')).toBe(WEBVIEW_HOME_DEFAULT)
  })

  it('hides the toolbar until right-click toggles it', () => {
    render(<WebViewWidget />)
    expect(screen.queryByLabelText('Web address')).toBeNull()
    fireEvent.contextMenu(screen.getByTestId('day-webview'))
    expect(screen.getByLabelText('Web address')).toBeDefined()
    fireEvent.contextMenu(screen.getByTestId('day-webview'))
    expect(screen.queryByLabelText('Web address')).toBeNull()
  })

  it('reveals the toolbar from its toggle button with aria-expanded', () => {
    render(<WebViewWidget />)
    const toggle = screen.getByRole('button', { name: 'Show web controls' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide web controls' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('Web address')).toBeDefined()
  })

  it('toggles the toolbar on its own guest right-click, ignoring others', () => {
    setToggleBridge()
    try {
      render(<WebViewWidget />)
      pinGuestId(7)
      expect(screen.queryByLabelText('Web address')).toBeNull()
      /* A Peek's guest (or anyone else's) must not flip the tile. */
      fireGuestRightClick(9)
      expect(screen.queryByLabelText('Web address')).toBeNull()
      fireGuestRightClick(7)
      expect(screen.getByLabelText('Web address')).toBeDefined()
      fireGuestRightClick(7)
      expect(screen.queryByLabelText('Web address')).toBeNull()
    } finally {
      delete (window as unknown as { moki?: unknown }).moki
    }
  })

  it('keeps the native menu for right-clicks inside the pill', () => {
    render(<WebViewWidget />)
    fireEvent.contextMenu(screen.getByTestId('day-webview'))
    const input = screen.getByLabelText('Web address')
    /* The toggle ignores pill-originated events, so the native
     * cut/copy/paste menu survives and the bar stays open. */
    fireEvent.contextMenu(input)
    expect(screen.getByLabelText('Web address')).toBeDefined()
  })

  it('following a guest navigation never reloads the guest', () => {
    render(<WebViewWidget />)
    const frame = screen.getByTestId('day-webview-frame')
    fireEvent(
      frame,
      Object.assign(new Event('did-navigate'), { url: 'https://example.com/docs/page' })
    )
    /* Draft and persisted home follow along for resume… */
    showChrome()
    expect((screen.getByLabelText('Web address') as HTMLInputElement).value).toBe(
      'https://example.com/docs/page'
    )
    /* …but the loaded guest is untouched: no redirect-driven reload loop. */
    expect(frame.getAttribute('src')).toBe(WEBVIEW_HOME_DEFAULT)
  })

  it('submit and Expand commit a new guest URL', () => {
    const { container } = render(<WebViewWidget />)
    showChrome()
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'example.org/docs' } })
    fireEvent.submit(container.querySelector('.moki-day-webview-address')!)
    expect(screen.getByTestId('day-webview-frame').getAttribute('src')).toBe('https://example.org/docs')
  })
})
