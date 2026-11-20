import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  WebViewWidget,
  WEBVIEW_HOME_DEFAULT,
  WEBVIEW_PARTITION,
  WEBVIEW_STORAGE_KEY,
  normalizeAddress
} from './WebViewWidget'

afterEach(() => cleanup())
beforeEach(() => window.localStorage.clear())

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
    expect((screen.getByLabelText('Web address') as HTMLInputElement).value).toBe(
      'https://example.com/inbox'
    )
    const frame = screen.getByTestId('day-webview-frame')
    expect(frame.getAttribute('src')).toBe('https://example.com/inbox')
    expect(frame.getAttribute('partition')).toBe(WEBVIEW_PARTITION)
    expect(frame.getAttribute('sandbox')).toBe('')
  })

  it('falls back to the default home with nothing stored', () => {
    render(<WebViewWidget />)
    expect((screen.getByLabelText('Web address') as HTMLInputElement).value).toBe(WEBVIEW_HOME_DEFAULT)
  })

  it('navigates on submit and persists the normalized address', () => {
    const { container } = render(<WebViewWidget />)
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
    fireEvent.change(screen.getByLabelText('Web address'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.submit(container.querySelector('.moki-day-webview-address')!)
    expect(screen.getByRole('alert')).toBeDefined()
    expect(screen.getByTestId('day-webview-frame').getAttribute('src')).toBe(WEBVIEW_HOME_DEFAULT)
  })
})
