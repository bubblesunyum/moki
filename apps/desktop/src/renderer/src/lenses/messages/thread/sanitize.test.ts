import { describe, expect, it } from 'vitest'
import { sanitizeEmailHtml } from './sanitize'

describe('sanitizeEmailHtml', () => {
  it('strips script tags and their content', () => {
    const out = sanitizeEmailHtml('<p>hello</p><script>alert(1)</script>')
    expect(out).toContain('hello')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
  })

  it('strips event-handler attributes', () => {
    const out = sanitizeEmailHtml(
      '<p>hi</p><img src="https://example.com/a.png" onerror="alert(1)">'
    )
    expect(out).not.toContain('onerror')
    expect(out).toContain('https://example.com/a.png')
  })

  it('strips forms and form controls', () => {
    const out = sanitizeEmailHtml(
      '<form action="https://evil.example/submit"><input type="text" name="q"><button>Go</button></form><p>body</p>'
    )
    expect(out).not.toContain('<form')
    expect(out).not.toContain('<input')
    expect(out).not.toContain('<button')
    expect(out).toContain('body')
  })

  it('strips iframes and objects', () => {
    const out = sanitizeEmailHtml(
      '<iframe src="https://evil.example/"></iframe><object data="https://evil.example/x.swf"></object><p>body</p>'
    )
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<object')
    expect(out).toContain('body')
  })

  it('neutralizes javascript: links but keeps the link text', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('click')
  })

  it('keeps http(s) links and marks remote images no-referrer', () => {
    const out = sanitizeEmailHtml(
      '<a href="https://example.com/x">x</a><img src="https://example.com/a.png">'
    )
    expect(out).toContain('href="https://example.com/x"')
    expect(out).toContain('referrerpolicy="no-referrer"')
  })

  it('keeps style tags for the shadow root', () => {
    const out = sanitizeEmailHtml('<style>p{color:red}</style><p>body</p>')
    expect(out).toContain('<style>')
    expect(out).toContain('body')
  })

  it('neutralizes shadow-piercing selectors in style tags', () => {
    const out = sanitizeEmailHtml(
      '<style>:host{display:none}:host(.x){color:red}::slotted(p){color:blue}p{color:green}</style><p>body</p>'
    )
    expect(out).not.toContain(':host')
    expect(out).not.toContain('::slotted')
    expect(out).toContain('p{color:green}')
    expect(out).toContain('body')
  })
})
