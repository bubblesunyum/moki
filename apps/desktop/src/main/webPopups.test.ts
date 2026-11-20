import { beforeEach, describe, expect, it, vi } from 'vitest'

/* Electron is mocked: the popup route only touches app/web-contents-created,
 * setWindowOpenHandler, and the owner-window send — all faked here. */
const createdListeners: Array<(...args: never[]) => void> = []
const sendCalls: Array<{ channel: unknown; method: unknown; params: unknown }> = []

vi.mock('electron', () => ({
  app: {
    on: (event: string, cb: (...args: never[]) => void): void => {
      if (event === 'web-contents-created') createdListeners.push(cb)
    }
  },
  BrowserWindow: {
    fromWebContents: (contents: { __owner?: FakeOwnerWindow | null }): unknown =>
      contents.__owner ?? null
  }
}))

interface FakeOwnerWindow {
  webContents: { send: (...args: never[]) => void }
  isDestroyed: () => boolean
}

import { setupWebviewPopups } from './webPopups'

interface FakeHandler {
  (details: { url: string }): { action: 'deny' }
}

interface FakeContents {
  __owner?: FakeOwnerWindow | null
  getType(): string
  hostWebContents: unknown
  setWindowOpenHandler(handler: FakeHandler): void
}

function makeGuest(owner: FakeContents['__owner'] = null): { contents: FakeContents; handler: () => FakeHandler } {
  let handler: FakeHandler = () => ({ action: 'deny' })
  const contents: FakeContents = {
    __owner: owner,
    getType: () => 'webview',
    hostWebContents: { __owner: owner },
    setWindowOpenHandler: (h: FakeHandler): void => {
      handler = h
    }
  }
  return { contents, handler: () => handler }
}

function emitCreated(contents: FakeContents): void {
  for (const cb of createdListeners) cb({} as never, contents as never)
}

function makeOwner(): {
  webContents: { send: (...args: never[]) => void }
  isDestroyed: () => boolean
} {
  return {
    webContents: {
      send: (channel: unknown, method: unknown, params: unknown): void => {
        sendCalls.push({ channel, method, params })
      }
    },
    isDestroyed: () => false
  }
}

beforeEach(() => {
  createdListeners.length = 0
  sendCalls.length = 0
  setupWebviewPopups()
})

describe('setupWebviewPopups', () => {
  it('denies the native window and forwards http(s) popups to the owner window', () => {
    const owner = makeOwner()
    const { contents, handler } = makeGuest(owner)
    emitCreated(contents)
    const decision = handler()({ url: 'https://accounts.example.com/o/auth' })
    expect(decision).toEqual({ action: 'deny' })
    expect(sendCalls).toEqual([
      { channel: 'rpc:notify', method: 'web.popup', params: { url: 'https://accounts.example.com/o/auth' } }
    ])
  })

  it('swallows non-http(s) popups without notifying', () => {
    const owner = makeOwner()
    const { contents, handler } = makeGuest(owner)
    emitCreated(contents)
    expect(handler()({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
    expect(handler()({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(sendCalls).toHaveLength(0)
  })

  it('ignores non-webview contents and ownerless guests', () => {
    const plain = {
      getType: () => 'browser-window',
      setWindowOpenHandler: vi.fn()
    }
    emitCreated(plain as never)
    expect(plain.setWindowOpenHandler).not.toHaveBeenCalled()
    const { contents, handler } = makeGuest(null)
    emitCreated(contents)
    expect(handler()({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    expect(sendCalls).toHaveLength(0)
  })
})
