import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HelperStatus } from './HelperStatus'
import { RpcProvider } from './provider'

function mockMoki(call: (...args: never[]) => Promise<never>) {
  Object.defineProperty(window, 'moki', {
    value: { call, on: vi.fn(() => () => {}), openExternal: vi.fn() },
    configurable: true
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('HelperStatus', () => {
  it('shows the helper version when ping succeeds', async () => {
    mockMoki(async () => ({ ok: true, version: '0.1.0' }) as never)
    render(
      <RpcProvider>
        <HelperStatus />
      </RpcProvider>
    )
    const el = await screen.findByText('helper ok · v0.1.0')
    expect(el).not.toBeNull()
  })

  it('shows down when ping fails', async () => {
    mockMoki(async () => {
      throw new Error('helper not running')
    })
    render(
      <RpcProvider>
        <HelperStatus />
      </RpcProvider>
    )
    const el = await screen.findByText('helper down')
    expect(el).not.toBeNull()
  })

  it('shows a quiet no-bridge state when the preload is missing', async () => {
    Reflect.deleteProperty(window, 'moki')
    render(
      <RpcProvider>
        <HelperStatus />
      </RpcProvider>
    )
    const el = await screen.findByText('helper no bridge')
    expect(el).not.toBeNull()
  })

  it('follows helper.status bridge events', async () => {
    let statusCb: ((params: { status: 'starting' | 'ok' | 'down' }) => void) | null = null
    Object.defineProperty(window, 'moki', {
      value: {
        call: () => new Promise(() => {}),
        on: vi.fn((_event: unknown, cb: (params: never) => void) => {
          statusCb = cb as (params: { status: 'starting' | 'ok' | 'down' }) => void
          return () => {}
        }),
        openExternal: vi.fn()
      },
      configurable: true
    })
    render(
      <RpcProvider>
        <HelperStatus />
      </RpcProvider>
    )
    await screen.findByText('helper …')
    if (!statusCb) throw new Error('missing status subscription')
    const cb: (params: { status: 'starting' | 'ok' | 'down' }) => void = statusCb
    act(() => {
      cb({ status: 'down' })
    })
    const el = await screen.findByText('helper down')
    expect(el).not.toBeNull()
  })
})
