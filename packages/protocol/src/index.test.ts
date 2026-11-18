import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_VERSION,
  isExternalHttpUrl,
  type MailGetThreadParams,
  type MailListThreadsParams,
  type MailListThreadsResult,
  type RpcErrorShape,
  type RpcMethodMap,
  type ThreadDetail
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

  it('types mail.listThreads', () => {
    const params: MailListThreadsParams = { label: 'INBOX' }
    const withCursor: MailListThreadsParams = {
      label: 'psymail/commerce',
      cursor: { 'a@example.com': 'token123' }
    }
    const result: MailListThreadsResult = {
      threads: [
        {
          id: 't1',
          account: 'a@example.com',
          from: { name: 'Clayton Gibson', address: 'clayton@example.com' },
          subject: 'Plant swap this weekend?',
          snippet: 'Still good for Saturday?',
          date: new Date().toISOString(),
          unread: true,
          messageCount: 1,
          labelIds: ['INBOX', 'UNREAD']
        }
      ],
      next: { 'a@example.com': 'token456' },
      unreachable: [],
      authExpired: ['b@example.com']
    }
    expect(params.label).toBe('INBOX')
    expect(withCursor.cursor?.['a@example.com']).toBe('token123')
    expect(result.threads).toHaveLength(1)
    // Dates cross as ISO8601 strings, so they must round-trip.
    expect(Number.isNaN(Date.parse(result.threads[0].date))).toBe(false)
    expect(result.authExpired).toEqual(['b@example.com'])
  })

  it('types mail.getThread', () => {
    const params: MailGetThreadParams = { account: 'a@example.com', id: 't1' }
    const result: ThreadDetail = {
      id: 't1',
      account: 'a@example.com',
      subject: 'Plant swap this weekend?',
      messages: [
        {
          id: 'm1',
          from: { name: 'Clayton Gibson', address: 'clayton@example.com' },
          to: [{ name: 'Bubbles', address: 'a@example.com' }],
          cc: [],
          date: new Date().toISOString(),
          html: '<a href="https://example.com/swap">RSVP here</a>',
          text: 'Still good for Saturday?',
          isFromMe: false
        }
      ]
    }
    expect(params.id).toBe('t1')
    expect(result.messages[0].html).toContain('https://example.com/swap')
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
