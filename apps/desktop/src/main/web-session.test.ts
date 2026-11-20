import { beforeEach, describe, expect, it, vi } from 'vitest'

/* Electron is mocked: the pure guards need no Electron at all, and the
 * install path only touches session.fromPartition, the permission/download
 * handlers, and app/web-contents-created — all faked here. */
const createdListeners: Array<(...args: never[]) => void> = []

interface FakeSession {
  permissionRequestHandler: ((...args: never[]) => void) | null
  permissionCheckHandler: ((...args: never[]) => unknown) | null
  downloadHandler: ((...args: never[]) => void) | null
  setPermissionRequestHandler(h: (...args: never[]) => void): void
  setPermissionCheckHandler(h: (...args: never[]) => unknown): void
  on(event: string, cb: (...args: never[]) => void): void
}

const sessions: FakeSession[] = []

vi.mock('electron', () => ({
  app: {
    on: (event: string, cb: (...args: never[]) => void): void => {
      if (event === 'web-contents-created') createdListeners.push(cb)
    }
  },
  session: {
    fromPartition: (): FakeSession => {
      const fake: FakeSession = {
        permissionRequestHandler: null,
        permissionCheckHandler: null,
        downloadHandler: null,
        setPermissionRequestHandler(h) {
          fake.permissionRequestHandler = h
        },
        setPermissionCheckHandler(h) {
          fake.permissionCheckHandler = h
        },
        on(event, cb) {
          if (event === 'will-download') fake.downloadHandler = cb
        }
      }
      sessions.push(fake)
      return fake
    }
  }
}))

import {
  decidePopupUrl,
  installWebSession,
  isWebUrlAllowed,
  sanitizeWebviewAttach,
  shouldAllowWebPermission,
  WEBSITES_PARTITION
} from './web-session'
import { isExternalHttpUrl } from '../../../../packages/protocol/src/index'

beforeEach(() => {
  createdListeners.length = 0
  sessions.length = 0
})

describe('web-session partition', () => {
  it('shares the one persisted partition with the renderer guests', () => {
    expect(WEBSITES_PARTITION).toBe('persist:moki-websites')
  })
})

describe('isWebUrlAllowed', () => {
  it('allows http(s) pages and denies everything else', () => {
    expect(isWebUrlAllowed('https://drive.google.com/file/d/1/view')).toBe(true)
    expect(isWebUrlAllowed('http://intranet.example/docs')).toBe(true)
    expect(isWebUrlAllowed('file:///etc/passwd')).toBe(false)
    expect(isWebUrlAllowed('javascript:alert(1)')).toBe(false)
    expect(isWebUrlAllowed('data:text/html,<h1>x</h1>')).toBe(false)
    expect(isWebUrlAllowed('blob:https://example.com/uuid')).toBe(false)
    expect(isWebUrlAllowed('about:blank')).toBe(false)
    expect(isWebUrlAllowed('ftp://example.com/x')).toBe(false)
  })

  it('default-denies missing and unparseable URLs', () => {
    expect(isWebUrlAllowed(null)).toBe(false)
    expect(isWebUrlAllowed(undefined)).toBe(false)
    expect(isWebUrlAllowed('')).toBe(false)
    expect(isWebUrlAllowed('not a url')).toBe(false)
    expect(isWebUrlAllowed('https://')).toBe(false)
  })

  it('shares the protocol allowlist, padded URLs included', () => {
    expect(isWebUrlAllowed('  https://example.com/docs  ')).toBe(true)
    expect(isWebUrlAllowed('  http://intranet.example/docs  ')).toBe(true)
    expect(isWebUrlAllowed('   ')).toBe(false)
  })
})

describe('allowlist parity', () => {
  it('agrees with the protocol allowlist on every input, padded URLs included', () => {
    const inputs: unknown[] = [
      'https://example.com/docs',
      'http://intranet.example/docs',
      'HTTPS://EXAMPLE.COM/',
      '  https://example.com/padded  ',
      '\thttp://example.com/tabbed\n',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<h1>x</h1>',
      'blob:https://example.com/uuid',
      'about:blank',
      'ftp://example.com/x',
      'https://',
      'http://',
      'not a url',
      '',
      '   ',
      null,
      undefined,
      42,
      {}
    ]
    const allowed = isWebUrlAllowed as (url: unknown) => boolean
    for (const input of inputs) {
      expect(allowed(input)).toBe(isExternalHttpUrl(input))
    }
  })
})

describe('sanitizeWebviewAttach', () => {
  it('forces the hardened shape and keeps allowed src', () => {
    const prefs = { preload: '/evil.js', preloadURL: '/evil2.js', sandbox: false, partition: 'persist:other' }
    const refuse = sanitizeWebviewAttach(prefs, { src: 'https://example.com/docs' })
    expect(refuse).toBe(false)
    expect(prefs).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: WEBSITES_PARTITION
    })
  })

  it('refuses non-web src so the caller destroys the guest', () => {
    expect(sanitizeWebviewAttach({}, { src: 'file:///etc/passwd' })).toBe(true)
    expect(sanitizeWebviewAttach({}, {})).toBe(true)
  })
})

describe('shouldAllowWebPermission', () => {
  it('grants only the async-clipboard write on http(s) requesters', () => {
    expect(shouldAllowWebPermission('clipboard-sanitized-write', 'https://example.com/')).toBe(true)
    expect(shouldAllowWebPermission('clipboard-write', 'https://example.com/')).toBe(false)
    expect(shouldAllowWebPermission('clipboard-sanitized-write', 'file:///etc/passwd')).toBe(false)
    expect(shouldAllowWebPermission('clipboard-read', 'https://example.com/')).toBe(false)
    expect(shouldAllowWebPermission('camera', 'https://example.com/')).toBe(false)
    expect(shouldAllowWebPermission('microphone', 'https://example.com/')).toBe(false)
    expect(shouldAllowWebPermission('notifications', 'https://example.com/')).toBe(false)
    expect(shouldAllowWebPermission('geolocation', 'https://example.com/')).toBe(false)
    expect(shouldAllowWebPermission('clipboard-sanitized-write', null)).toBe(false)
  })
})

describe('decidePopupUrl', () => {
  it('allows http(s) popups onto the Peek route and denies the rest', () => {
    expect(decidePopupUrl('https://accounts.example.com/o/auth')).toBe('allow')
    expect(decidePopupUrl('http://example.com/')).toBe('allow')
    expect(decidePopupUrl('javascript:alert(1)')).toBe('deny')
    expect(decidePopupUrl('file:///etc/passwd')).toBe('deny')
    expect(decidePopupUrl('about:blank')).toBe('deny')
  })
})

describe('installWebSession', () => {
  it('denies permissions by default and cancels downloads with a notice', () => {
    const notices: Array<{ kind: string; url: string }> = []
    installWebSession({ notify: (notice) => notices.push(notice) })
    expect(sessions).toHaveLength(1)
    const fake = sessions[0]

    const granted: boolean[] = []
    fake.permissionRequestHandler?.(
      { getURL: () => 'https://example.com/' } as never,
      'camera' as never,
      ((allow: boolean) => granted.push(allow)) as never,
      { requestingUrl: 'https://example.com/' } as never
    )
    fake.permissionRequestHandler?.(
      { getURL: () => 'https://example.com/' } as never,
      'clipboard-sanitized-write' as never,
      ((allow: boolean) => granted.push(allow)) as never,
      { requestingUrl: 'https://example.com/' } as never
    )
    expect(granted).toEqual([false, true])
    expect(
      fake.permissionCheckHandler?.(
        { getURL: () => 'https://example.com/' } as never,
        'camera' as never,
        'https://example.com' as never,
        {} as never
      )
    ).toBe(false)

    let prevented = false
    fake.downloadHandler?.({ preventDefault: () => { prevented = true } } as never, {
      getURL: () => 'https://example.com/file.pdf'
    } as never)
    expect(prevented).toBe(true)
    expect(notices).toEqual([{ kind: 'download-blocked', url: 'https://example.com/file.pdf' }])
  })

  it('holds non-http(s) main-frame navigations and redirects, and ignores non-webviews', () => {
    installWebSession({ notify: () => {} })
    const listeners = new Map<string, (...args: never[]) => void>()
    const guest = {
      getType: () => 'webview',
      on: (event: string, cb: (...args: never[]) => void): void => {
        listeners.set(event, cb)
      }
    }
    for (const cb of createdListeners) cb({} as never, guest as never)
    const nav = listeners.get('will-navigate')
    const redirect = listeners.get('will-redirect')
    const frameNav = listeners.get('will-frame-navigate')
    const runGuard = (
      handler: ((...args: never[]) => void) | undefined,
      url: string,
      isMainFrame?: boolean
    ): boolean => {
      let prevented = false
      handler?.({ url, isMainFrame, preventDefault: (): void => { prevented = true } } as never)
      return prevented
    }
    expect(runGuard(nav, 'https://example.com/a')).toBe(false)
    expect(runGuard(nav, 'file:///etc/passwd')).toBe(true)
    expect(runGuard(redirect, 'https://example.com/final')).toBe(false)
    expect(runGuard(redirect, 'javascript:alert(1)')).toBe(true)
    // Only the top page is allowlisted; subframe scaffolding is the site's business.
    expect(runGuard(frameNav, 'https://example.com/frame', true)).toBe(false)
    expect(runGuard(frameNav, 'file:///etc/passwd', true)).toBe(true)
    expect(runGuard(frameNav, 'about:blank', false)).toBe(false)

    // Non-webview contents are embedders: they get only the attach-time hardener.
    const plainListeners = new Map<string, (...args: never[]) => void>()
    const plain = {
      getType: () => 'browser-window',
      on: (event: string, cb: (...args: never[]) => void): void => {
        plainListeners.set(event, cb)
      }
    }
    for (const cb of createdListeners) cb({} as never, plain as never)
    expect([...plainListeners.keys()]).toEqual(['will-attach-webview'])
  })

  it('wires will-attach-webview so the sanitizer actually runs at attach time', () => {
    installWebSession({ notify: () => {} })
    const embedderListeners = new Map<string, (...args: never[]) => void>()
    const embedder = {
      getType: () => 'browser-window',
      on: (event: string, cb: (...args: never[]) => void): void => {
        embedderListeners.set(event, cb)
      }
    }
    for (const cb of createdListeners) cb({} as never, embedder as never)
    const attach = embedderListeners.get('will-attach-webview')
    expect(attach).toBeDefined()

    const runAttach = (
      prefs: Record<string, unknown>,
      params: Record<string, unknown>
    ): { prefs: Record<string, unknown>; prevented: boolean } => {
      let prevented = false
      attach?.(
        { preventDefault: (): void => { prevented = true } } as never,
        prefs as never,
        params as never
      )
      return { prefs, prevented }
    }

    // Allowed src: prefs forced into the hardened shape, guest lives.
    const allowed = runAttach(
      { preload: '/evil.js', preloadURL: '/evil2.js', sandbox: false, partition: 'persist:other' },
      { src: 'https://example.com/docs' }
    )
    expect(allowed.prevented).toBe(false)
    expect(allowed.prefs).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: WEBSITES_PARTITION
    })

    // Non-web src: same hardening, then the attach refuses (guest destroyed).
    const refused = runAttach({ preload: '/evil.js' }, { src: 'file:///etc/passwd' })
    expect(refused.prevented).toBe(true)
    expect(refused.prefs.partition).toBe(WEBSITES_PARTITION)
    expect(refused.prefs).not.toHaveProperty('preload')

    // Missing src refuses too.
    expect(runAttach({}, {}).prevented).toBe(true)
  })
})
