import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_VERSION,
  isExternalHttpUrl,
  type RpcErrorShape,
  type RpcMethodMap
} from './index'

describe('protocol', () => {
  it('exposes the protocol version', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })

  it('types helper.ping', () => {
    const result: RpcMethodMap['helper.ping']['result'] = { ok: true, version: '0.1.0' }
    expect(result.ok).toBe(true)
  })

  it('types accounts.list', () => {
    const result: RpcMethodMap['accounts.list']['result'] = {
      accounts: [
        { address: 'a@example.com', status: 'ok' },
        { address: 'b@example.com', name: 'B', status: 'auth_expired' },
        { address: 'c@example.com', status: 'unreachable' }
      ],
      psymailImport: 'pending'
    }
    expect(result.accounts).toHaveLength(3)
  })

  it('shapes RpcError with optional app code', () => {
    const err: RpcErrorShape = { code: -32000, message: 'expired', data: { code: 'auth_expired' } }
    expect(err.data?.code).toBe('auth_expired')
  })

  it('accepts only absolute http(s) URLs for openExternal', () => {
    expect(isExternalHttpUrl('https://example.com/x')).toBe(true)
    expect(isExternalHttpUrl('http://example.com')).toBe(true)
    expect(isExternalHttpUrl('  https://example.com/  ')).toBe(true)
    expect(isExternalHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalHttpUrl('ftp://example.com')).toBe(false)
    expect(isExternalHttpUrl('https://')).toBe(false)
    expect(isExternalHttpUrl('')).toBe(false)
    expect(isExternalHttpUrl(undefined)).toBe(false)
    expect(isExternalHttpUrl(null)).toBe(false)
    expect(isExternalHttpUrl(42)).toBe(false)
    expect(isExternalHttpUrl({})).toBe(false)
  })
})
