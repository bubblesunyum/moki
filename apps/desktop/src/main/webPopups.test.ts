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
  id: number
  getType(): string
  hostWebContents: unknown
  setWindowOpenHandler(handler: FakeHandler): void
  on(event: string, cb: (...args: never[]) => void): void
}

let nextGuestId = 1

function makeGuest(owner: FakeContents['__owner'] = null): {
  contents: FakeContents
  handler: () => FakeHandler
  emit: (event: string) => void
} {
  let handler: FakeHandler = () => ({ action: 'deny' })
  const listeners = new Map<string, (...args: never[]) => void>()
  const contents: FakeContents = {
    __owner: owner,
    id: nextGuestId++,
    getType: () => 'webview',
    hostWebContents: { __owner: owner },
    setWindowOpenHandler: (h: FakeHandler): void => {
      handler = h
    },
    on: (event: string, cb: (...args: never[]) => void): void => {
      listeners.set(event, cb)
    }
  }
  return { contents, handler: () => handler, emit: (event: string) => listeners.get(event)?.() }
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
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    }
    emitCreated(plain as never)
    expect(plain.setWindowOpenHandler).not.toHaveBeenCalled()
    const { contents, handler } = makeGuest(null)
    emitCreated(contents)
    expect(handler()({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    expect(sendCalls).toHaveLength(0)
  })

  it('forwards guest right-clicks with the guest id', () => {
    const owner = makeOwner()
    const { contents, emit } = makeGuest(owner)
    emitCreated(contents)
    emit('context-menu')
    expect(sendCalls).toEqual([
      { channel: 'rpc:notify', method: 'web.contextMenu', params: { guestId: contents.id } }
    ])
  })

  it('ignores guest right-clicks with no live owner', () => {
    const { contents, emit } = makeGuest(null)
    emitCreated(contents)
    emit('context-menu')
    expect(sendCalls).toHaveLength(0)
  })
})
