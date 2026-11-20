import { describe, expect, it, vi } from 'vitest'
import { isExternalHttpUrl } from '../../../../../packages/protocol/src/index'
import { __test__, isOpenExternalAllowed } from './ipc'

describe('helper ipc', () => {
  it('only allows http(s) URLs for openExternal', () => {
    expect(isExternalHttpUrl('https://example.com/x')).toBe(true)
    expect(isExternalHttpUrl('http://example.com')).toBe(true)
    expect(isExternalHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalHttpUrl('ftp://example.com')).toBe(false)
    expect(isExternalHttpUrl(42)).toBe(false)
    expect(isExternalHttpUrl(undefined)).toBe(false)
  })

  it('also allows Craft deep links for openExternal, nothing else', () => {
    expect(isOpenExternalAllowed('https://example.com/x')).toBe(true)
    expect(isOpenExternalAllowed('craftdocs://open?spaceId=abc&blockId=def')).toBe(true)
    expect(isOpenExternalAllowed('craftdocs://open')).toBe(true)
    expect(isOpenExternalAllowed('craftdocs://open?spaceId=a+b&blockId=c:d')).toBe(true)
    expect(isOpenExternalAllowed('craftdocs://open foo')).toBe(false)
    expect(isOpenExternalAllowed('craftdocs://open\\evil.com')).toBe(false)
    expect(isOpenExternalAllowed('craftdocs:open')).toBe(false)
    expect(isOpenExternalAllowed('file:///etc/passwd')).toBe(false)
    expect(isOpenExternalAllowed('javascript:alert(1)')).toBe(false)
  })

  it('exposes the expected channel names', () => {
    expect(__test__.RPC_CHANNEL).toBe('rpc')
    expect(__test__.NOTIFY_CHANNEL).toBe('rpc:notify')
    expect(__test__.OPEN_EXTERNAL_CHANNEL).toBe('shell:openExternal')
  })

  it('forwards rpc calls and validates openExternal through ipcMain', async () => {
    const { setupHelperIpc } = await import('./ipc')
    const handlers = new Map<string, (...args: any[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, fn: (...args: any[]) => unknown) => {
        handlers.set(channel, fn)
      })
    }
    const shell = { openExternal: vi.fn(async () => undefined as never) }
    const helper = {
      call: vi.fn(async (method: string) => `result:${method}`),
      onNotification: vi.fn(() => () => {}),
      onStatus: vi.fn(() => () => {})
    }
    const send = vi.fn()
    const getWindows = () => [{ webContents: { send } }] as never[]

    setupHelperIpc(
      ipcMain as never,
      shell as never,
      helper as never,
      getWindows as never
    )

    const rpc = handlers.get('rpc')
    if (!rpc) throw new Error('missing rpc handler')
    await expect(rpc({}, 'helper.ping')).resolves.toBe('result:helper.ping')

    const open = handlers.get('shell:openExternal')
    if (!open) throw new Error('missing openExternal handler')
    await open({}, 'https://example.com')
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
    await expect(open({}, 'file:///x')).rejects.toThrow(/blocked/)
    await expect(open({}, 42)).rejects.toThrow(/blocked/)
  })

  it('translates helper status changes to the renderer once', async () => {
    const { setupHelperIpc } = await import('./ipc')
    const ipcMain = { handle: vi.fn() }
    const shell = { openExternal: vi.fn() }
    let statusCb: ((status: 'ok' | 'down') => void) | null = null
    const helper = {
      call: vi.fn(),
      onNotification: vi.fn(() => () => {}),
      onStatus: vi.fn((cb: (status: 'ok' | 'down') => void) => {
        statusCb = cb
        return () => {}
      })
    }
    const send = vi.fn()
    const getWindows = () => [{ webContents: { send } }] as never[]

    setupHelperIpc(
      ipcMain as never,
      shell as never,
      helper as never,
      getWindows as never
    )

    if (!statusCb) throw new Error('missing onStatus subscription')
    const cb: (status: 'ok' | 'down') => void = statusCb
    cb('down')
    expect(send).toHaveBeenCalledWith('rpc:notify', 'helper.status', { status: 'down' })
    cb('ok')
    expect(send).toHaveBeenCalledWith('rpc:notify', 'helper.status', { status: 'ok' })
    expect(helper.onStatus).toHaveBeenCalledTimes(1)
  })
})
