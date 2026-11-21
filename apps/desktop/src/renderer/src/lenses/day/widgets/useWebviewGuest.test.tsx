import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useSandboxedWebview, type WebviewGuestElement } from './useWebviewGuest'

afterEach(() => {
  cleanup()
})

/* jsdom has no <webview>: a plain element stands in for the guest, with
 * only the methods the test needs attached. */
function makeGuest(): WebviewGuestElement & {
  executeJavaScript: ReturnType<typeof vi.fn>
} {
  const el = document.createElement('div') as unknown as WebviewGuestElement & {
    executeJavaScript: ReturnType<typeof vi.fn>
  }
  el.executeJavaScript = vi.fn().mockResolvedValue('ok')
  return el
}

function inPageEvent(url: string, isMainFrame = true): Event {
  const ev = new Event('did-navigate-in-page') as Event & {
    url?: string
    isMainFrame?: boolean
  }
  ev.url = url
  ev.isMainFrame = isMainFrame
  return ev
}

describe('useSandboxedWebview routeInPage', () => {
  it('rejects — never throws — with no live guest', async () => {
    const { result } = renderHook(() => useSandboxedWebview({ onNavigate: () => {} }))
    await expect(result.current.routeInPage('https://example.com/a')).rejects.toThrow()
  })

  it('rejects with a detached guest, so callers can fall back to src', async () => {
    const { result } = renderHook(() => useSandboxedWebview({ onNavigate: () => {} }))
    const guest = makeGuest()
    act(() => {
      result.current.setView(guest)
    })
    act(() => {
      result.current.setView(null)
    })
    await expect(result.current.routeInPage('https://example.com/a')).rejects.toThrow()
  })

  it('rejects unsafe URLs without touching the guest', async () => {
    const { result } = renderHook(() => useSandboxedWebview({ onNavigate: () => {} }))
    const guest = makeGuest()
    act(() => {
      result.current.setView(guest)
    })
    await expect(result.current.routeInPage('javascript:alert(1)')).rejects.toThrow()
    await expect(result.current.routeInPage('')).rejects.toThrow()
    expect(guest.executeJavaScript).not.toHaveBeenCalled()
  })

  it('hops via pushState with the URL JSON-embedded in the script', async () => {
    const { result } = renderHook(() => useSandboxedWebview({ onNavigate: () => {} }))
    const guest = makeGuest()
    act(() => {
      result.current.setView(guest)
    })
    const url = 'https://docs.craft.do/editor/d/space/A7C5E2D4?a=1&b=2'
    await expect(result.current.routeInPage(url)).resolves.toBeUndefined()
    expect(guest.executeJavaScript).toHaveBeenCalledTimes(1)
    const script = guest.executeJavaScript.mock.calls[0][0] as string
    expect(script).toContain(JSON.stringify(url))
    expect(script).toContain('history.pushState')
    expect(script).toContain('popstate')
  })

  it('propagates an injection failure so the caller falls back', async () => {
    const { result } = renderHook(() => useSandboxedWebview({ onNavigate: () => {} }))
    const guest = makeGuest()
    guest.executeJavaScript.mockRejectedValueOnce(new Error('boom'))
    act(() => {
      result.current.setView(guest)
    })
    await expect(result.current.routeInPage('https://example.com/a')).rejects.toThrow('boom')
  })

  it('reports main-frame in-page navigations without changing onNavigate', () => {
    const onNavigate = vi.fn()
    const onInPage = vi.fn()
    const { result } = renderHook(() => useSandboxedWebview({ onNavigate, onInPage }))
    const guest = makeGuest()
    act(() => {
      result.current.setView(guest)
    })
    guest.dispatchEvent(inPageEvent('https://example.com/in-page'))
    expect(onNavigate).toHaveBeenCalledWith('https://example.com/in-page')
    expect(onInPage).toHaveBeenCalledWith('https://example.com/in-page')
  })

  it('ignores subframe in-page events for the in-page signal', () => {
    const onInPage = vi.fn()
    const { result } = renderHook(() => useSandboxedWebview({ onNavigate: () => {}, onInPage }))
    const guest = makeGuest()
    act(() => {
      result.current.setView(guest)
    })
    guest.dispatchEvent(inPageEvent('https://example.com/sub', false))
    expect(onInPage).not.toHaveBeenCalled()
  })

  it('stays silent for consumers without the in-page signal', () => {
    const onNavigate = vi.fn()
    const { result } = renderHook(() => useSandboxedWebview({ onNavigate }))
    const guest = makeGuest()
    act(() => {
      result.current.setView(guest)
    })
    guest.dispatchEvent(inPageEvent('https://example.com/in-page'))
    expect(onNavigate).toHaveBeenCalledWith('https://example.com/in-page')
  })
})
