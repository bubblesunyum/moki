import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { initialPeekUrl, WebViewWidget } from './WebViewWidget'
import { WebPeek } from './WebPeek'
import { hostOf, isSecureUrl, normalizeAddress, WEBVIEW_HOME_DEFAULT } from './webviewShared'

function emit(el: Element, type: string, url: string, extra?: Record<string, unknown>): void {
  /* Through fireEvent so React flushes the state update before we assert. */
  fireEvent(el, Object.assign(new Event(type), { url }, extra))
}

function setMockBridge(): { openExternal: ReturnType<typeof vi.fn> } {
  const openExternal = vi.fn().mockResolvedValue(undefined)
  ;(window as unknown as { moki: unknown }).moki = { openExternal }
  return { openExternal }
}

function clearMockBridge(): void {
  delete (window as unknown as { moki?: unknown }).moki
}

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

beforeEach(() => window.localStorage.clear())

describe('hostOf', () => {
  it('returns the hostname and never an empty string', () => {
    expect(hostOf('https://accounts.example.com/o/oauth2/auth?x=1')).toBe('accounts.example.com')
    expect(hostOf('not a url')).toBe('not a url')
  })
})

describe('initialPeekUrl', () => {
  it('opens validated ?mokiPeek= addresses and rejects the rest', () => {
    window.history.replaceState({}, '', '/?mokiPeek=https://auth.example.com/login')
    expect(initialPeekUrl()).toBe('https://auth.example.com/login')
    window.history.replaceState({}, '', '/?mokiPeek=javascript:alert(1)')
    expect(initialPeekUrl()).toBeNull()
    window.history.replaceState({}, '', '/')
    expect(initialPeekUrl()).toBeNull()
  })
})

describe('WebPeek', () => {
  it('renders the dialog with the host and a sandboxed frame', () => {
    render(<WebPeek url="https://accounts.example.com/o/auth" onClose={() => {}} onExpand={() => {}} />)
    expect(screen.getByTestId('web-peek')).toBeDefined()
    expect(screen.getByRole('dialog', { name: 'Preview of accounts.example.com' })).toBeDefined()
    const frame = screen.getByTestId('web-peek-frame')
    expect(frame.getAttribute('src')).toBe('https://accounts.example.com/o/auth')
    expect(frame.getAttribute('partition')).toBe('persist:moki-websites')
    expect(frame.getAttribute('sandbox')).toBe('')
  })

  it('closes on Escape', () => {
    let closed = false
    render(<WebPeek url="https://example.com" onClose={() => { closed = true }} onExpand={() => {}} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closed).toBe(true)
  })

  it('expands with ⌘O and follows validated in-peek redirects', () => {
    let expanded: string | null = null
    render(
      <WebPeek
        url="https://auth.example.com/start"
        onClose={() => {}}
        onExpand={(url) => { expanded = url }}
      />
    )
    emit(screen.getByTestId('web-peek-frame'), 'did-navigate', 'https://auth.example.com/finish')
    expect(screen.getByRole('dialog', { name: 'Preview of auth.example.com' })).toBeDefined()
    fireEvent.keyDown(window, { key: 'o', metaKey: true })
    expect(expanded).toBe('https://auth.example.com/finish')
  })

  it('ignores in-peek navigations to unsafe schemes', () => {
    render(<WebPeek url="https://auth.example.com/start" onClose={() => {}} onExpand={() => {}} />)
    emit(screen.getByTestId('web-peek-frame'), 'did-navigate', 'javascript:alert(1)')
    expect(screen.getByRole('dialog', { name: 'Preview of auth.example.com' })).toBeDefined()
  })
})

describe('WebViewWidget peek', () => {
  it('opens a Peek on popup requests instead of leaving the app', () => {
    render(<WebViewWidget />)
    emit(screen.getByTestId('day-webview-frame'), 'new-window', 'https://accounts.example.com/o/auth')
    expect(screen.getByTestId('web-peek')).toBeDefined()
    expect(screen.getByRole('dialog', { name: 'Preview of accounts.example.com' })).toBeDefined()
    /* The tile home is untouched while the peek is open. */
    expect(screen.getByTestId('day-webview-frame').getAttribute('src')).toBe(WEBVIEW_HOME_DEFAULT)
  })

  it('blocks unsafe popup schemes quietly', () => {
    render(<WebViewWidget />)
    emit(screen.getByTestId('day-webview-frame'), 'new-window', 'javascript:alert(1)')
    expect(screen.queryByTestId('web-peek')).toBeNull()
  })

  it('dismisses on backdrop click, X and Escape', () => {
    render(<WebViewWidget />)
    emit(screen.getByTestId('day-webview-frame'), 'new-window', 'https://example.com/auth')
    fireEvent.mouseDown(screen.getByTestId('web-peek'))
    expect(screen.queryByTestId('web-peek')).toBeNull()

    emit(screen.getByTestId('day-webview-frame'), 'new-window', 'https://example.com/auth')
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(screen.queryByTestId('web-peek')).toBeNull()

    emit(screen.getByTestId('day-webview-frame'), 'new-window', 'https://example.com/auth')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('web-peek')).toBeNull()
  })

  it('expand promotes the peeked page into the tile', () => {
    render(<WebViewWidget />)
    emit(screen.getByTestId('day-webview-frame'), 'new-window', 'https://example.com/signed-in')
    fireEvent.click(screen.getByRole('button', { name: 'Open in tile' }))
    expect(screen.queryByTestId('web-peek')).toBeNull()
    expect(screen.getByTestId('day-webview-frame').getAttribute('src')).toBe('https://example.com/signed-in')
    expect(JSON.parse(window.localStorage.getItem('moki.day.webview.home') ?? 'null')).toBe(
      'https://example.com/signed-in'
    )
  })

  it('opens from ?mokiPeek= for captures', () => {
    window.history.replaceState({}, '', '/?mokiPeek=https://auth.example.com/login')
    render(<WebViewWidget />)
    expect(screen.getByRole('dialog', { name: 'Preview of auth.example.com' })).toBeDefined()
  })

  it('keeps the shared allowlist intact', () => {
    expect(normalizeAddress('example.com/inbox')).toBe('https://example.com/inbox')
    expect(normalizeAddress('file:///etc/passwd')).toBeNull()
    expect(isSecureUrl('https://example.com')).toBe(true)
    expect(isSecureUrl('http://example.com')).toBe(false)
  })

  it('shows no lock for plain http previews', () => {
    render(<WebPeek url="http://paywall.example/login" onClose={() => {}} onExpand={() => {}} />)
    /* The portal lands on body, not in the render container. */
    const peek = document.body.querySelector('[data-testid="web-peek"]')
    expect(peek?.querySelector('.moki-peek-host')?.textContent).toContain('paywall.example')
    /* The lock glyph only renders for https. */
    expect(peek?.innerHTML).not.toContain('lucide-lock')
    cleanup()
    render(<WebPeek url="https://paywall.example/login" onClose={() => {}} onExpand={() => {}} />)
    expect(document.body.querySelector('[data-testid="web-peek"]')?.innerHTML).toContain('lucide-lock')
  })

  it('a second popup retitles and re-targets Expand instead of going stale', () => {
    render(<WebViewWidget />)
    emit(screen.getByTestId('day-webview-frame'), 'new-window', 'https://first.example/a')
    expect(screen.getByRole('dialog', { name: 'Preview of first.example' })).toBeDefined()
    emit(screen.getByTestId('day-webview-frame'), 'new-window', 'https://second.example/b')
    expect(screen.getByRole('dialog', { name: 'Preview of second.example' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Open in tile' }))
    expect(screen.queryByTestId('web-peek')).toBeNull()
    expect(screen.getByTestId('day-webview-frame').getAttribute('src')).toBe('https://second.example/b')
  })

  it('forwards validated in-peek popups outside and blocks credentialed URLs', () => {
    const { openExternal } = setMockBridge()
    try {
      render(<WebPeek url="https://auth.example.com/start" onClose={() => {}} onExpand={() => {}} />)
      const frame = screen.getByTestId('web-peek-frame')
      emit(frame, 'new-window', 'https://app.example.com/next')
      expect(openExternal).toHaveBeenCalledWith('https://app.example.com/next')
      openExternal.mockClear()
      emit(frame, 'new-window', 'https://user:secret@evil.example/x')
      expect(openExternal).not.toHaveBeenCalled()
    } finally {
      clearMockBridge()
    }
  })

  it('tracks hash navigations into Expand', () => {
    let expanded: string | null = null
    render(
      <WebPeek
        url="https://app.example.com/#/login"
        onClose={() => {}}
        onExpand={(url) => { expanded = url }}
      />
    )
    const frame = screen.getByTestId('web-peek-frame')
    emit(frame, 'did-navigate-in-page', 'https://app.example.com/#/dashboard', { isMainFrame: true })
    fireEvent.click(screen.getByRole('button', { name: 'Open in tile' }))
    expect(expanded).toBe('https://app.example.com/#/dashboard')
    cleanup()
    render(
      <WebPeek url="https://app.example.com/#/login" onClose={() => {}} onExpand={() => { expanded = 'touched' }} />
    )
    const frame2 = screen.getByTestId('web-peek-frame')
    emit(frame2, 'did-navigate-in-page', 'https://evil.example/#/x', { isMainFrame: false })
    fireEvent.click(screen.getByRole('button', { name: 'Open in tile' }))
    expect(expanded).toBe('touched')
  })

  it('traps Tab inside the card and returns focus to the tile on dismiss', () => {
    render(<WebViewWidget />)
    const input = screen.getByLabelText('Web address') as HTMLInputElement
    input.focus()
    emit(screen.getByTestId('day-webview-frame'), 'new-window', 'https://example.com/a')
    expect(document.activeElement?.getAttribute('role')).toBe('dialog')
    /* Shift+Tab from anywhere outside wraps to the last control. */
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close preview')
    /* Tab from the last control wraps to the first. */
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Back')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('web-peek')).toBeNull()
    expect(document.activeElement).toBe(input)
  })
})
