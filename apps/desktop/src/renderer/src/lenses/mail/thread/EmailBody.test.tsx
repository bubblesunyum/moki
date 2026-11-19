import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EmailBody } from './EmailBody'

const threadCss = readFileSync(
  join(process.cwd(), 'apps/desktop/src/renderer/src/lenses/mail/thread/ThreadPane.css'),
  'utf8'
)

function mockMoki() {
  const openExternal = vi.fn(async (_url: string) => {})
  Object.defineProperty(window, 'moki', {
    value: { call: vi.fn(), on: vi.fn(() => () => {}), openExternal },
    configurable: true
  })
  return { openExternal }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('EmailBody', () => {
  it('renders sanitized html inside a shadow root', () => {
    mockMoki()
    render(<EmailBody html='<p>Hello</p><script>alert(1)</script>' text={null} />)
    const host = screen.getByTestId('email-html')
    const root = host.shadowRoot
    expect(root).not.toBeNull()
    expect(root?.innerHTML).toContain('Hello')
    expect(root?.innerHTML).not.toContain('<script')
    expect(root?.innerHTML).not.toContain('alert(1)')
  })

  it('opens shadow-root links externally and prevents navigation', () => {
    const { openExternal } = mockMoki()
    render(<EmailBody html='<p><a href="https://example.com/x">x</a></p>' text={null} />)
    const link = screen
      .getByTestId('email-html')
      .shadowRoot?.querySelector('a') as HTMLAnchorElement | null
    expect(link).not.toBeNull()
    const prevented = fireEvent.click(link as HTMLAnchorElement) === false
    expect(prevented).toBe(true)
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/x')
  })

  it('ignores non-http(s) shadow-root links', () => {
    const { openExternal } = mockMoki()
    render(<EmailBody html='<p><a href="javascript:alert(1)">x</a></p>' text={null} />)
    const link = screen
      .getByTestId('email-html')
      .shadowRoot?.querySelector('a') as HTMLAnchorElement | null
    // The sanitizer strips the javascript: href; if an anchor survives, the
    // click must still not reach openExternal.
    if (link != null) fireEvent.click(link)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('renders plain text pre-wrapped with autolinked urls', () => {
    const { openExternal } = mockMoki()
    render(<EmailBody html={null} text="see https://example.com/swap. ok" />)
    const body = screen.getByTestId('email-text')
    expect(body.textContent).toContain('https://example.com/swap')
    const link = body.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com/swap')
    fireEvent.click(link as HTMLAnchorElement)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/swap')
    const rule = threadCss.match(/\.moki-email-plain\s*\{([^}]*)\}/)
    expect(rule?.[1]).toContain('pre-wrap')
  })

  it('shows a quiet placeholder when there is no content', () => {
    mockMoki()
    render(<EmailBody html={null} text={null} />)
    expect(screen.getByTestId('email-text').textContent).toContain('empty message')
  })

  it('contains email CSS in an inner container our base styles win over', () => {
    mockMoki()
    render(
      <EmailBody
        html='<style>:host{display:none}.sneaky{position:fixed;top:0}</style><p class="sneaky">hi</p>'
        text={null}
      />
    )
    const root = screen.getByTestId('email-html').shadowRoot
    expect(root).not.toBeNull()
    // The email's hostile :host rule is neutralized and cannot reach our host.
    const emailStyle = root?.querySelector('.moki-email-content style')
    expect(emailStyle?.textContent).not.toContain(':host')
    // The body sits in an inner container the base stylesheet pins visible.
    const container = root?.querySelector('.moki-email-content')
    expect(container?.textContent).toContain('hi')
    const baseCss = root?.querySelector('style')?.textContent ?? ''
    expect(baseCss).toContain('.moki-email-content')
    expect(baseCss).toContain('!important')
  })
})
