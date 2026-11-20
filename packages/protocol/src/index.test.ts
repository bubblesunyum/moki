import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_VERSION,
  WEBSITES_PARTITION,
  isExternalHttpUrl,
  type DocItem,
  type DocsListRecentsParams,
  type DocsListRecentsResult,
  type MailGetThreadParams,
  type MailListThreadsParams,
  type MailListThreadsResult,
  type NotionListRecentsResult,
  type NotionSetTokenParams,
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
          pinned: false,
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

  it('types a pinned multi-message thread', () => {
    const result: MailListThreadsResult = {
      threads: [
        {
          id: 't2',
          account: 'a@example.com',
          from: { name: 'Priya', address: 'priya@example.com' },
          subject: 'Dinner Thursday?',
          snippet: '7ish is perfect',
          date: new Date().toISOString(),
          unread: false,
          messageCount: 3,
          pinned: true,
          labelIds: ['INBOX']
        }
      ],
      next: undefined,
      unreachable: [],
      authExpired: []
    }
    expect(result.threads[0].pinned).toBe(true)
    expect(result.threads[0].messageCount).toBe(3)
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

  it('pins the one websites partition every embedder shares', () => {
    // Main (web-session.ts, zenCookies.shared.ts) and renderer
    // (webviewShared.ts) must stay on this exact string — a mismatch
    // silently splits the cookie jar.
    expect(WEBSITES_PARTITION).toBe('persist:moki-websites')
  })

  it('accepts only absolute http(s) URLs for openExternal', () => {    expect(isExternalHttpUrl('https://example.com/x')).toBe(true)
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

  it('types docs.listRecents with one source param', () => {
    const params: DocsListRecentsParams = { source: 'drive' }
    const item: DocItem = {
      id: 'd1',
      title: 'Launch plan',
      source: 'drive',
      updatedAt: new Date().toISOString(),
      openUrl: 'https://drive.google.com/file/d/d1/view'
    }
    const result: DocsListRecentsResult = { items: [item], unreachable: false, signedOut: false }
    expect(params.source).toBe('drive')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].openUrl).toBe('https://drive.google.com/file/d/d1/view')
    // Dates cross as ISO8601 strings, so they must round-trip.
    expect(Number.isNaN(Date.parse(result.items[0].updatedAt))).toBe(false)
    expect(isExternalHttpUrl(result.items[0].openUrl)).toBe(true)
  })

  it('types per-source signed-out and unreachable flags', () => {
    const signedOut: DocsListRecentsResult = { items: [], unreachable: false, signedOut: true }
    const partial: DocsListRecentsResult = { items: [], unreachable: true, signedOut: false }
    expect(signedOut.signedOut).toBe(true)
    expect(partial.unreachable).toBe(true)
  })

  it('types notion.listRecents with an auth-state envelope', () => {
    const ok: NotionListRecentsResult = {
      status: 'ok',
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Roadmap',
          url: 'https://www.notion.so/roadmap-111',
          object: 'page',
          lastEditedTime: new Date().toISOString()
        }
      ]
    }
    const signedOut: NotionListRecentsResult = { status: 'signed_out', items: [] }
    const authExpired: NotionListRecentsResult = { status: 'auth_expired', items: [] }
    expect(ok.items).toHaveLength(1)
    expect(Number.isNaN(Date.parse(ok.items[0].lastEditedTime))).toBe(false)
    expect(signedOut.status).toBe('signed_out')
    expect(authExpired.items).toHaveLength(0)
  })

  it('types notion.setToken and notion.signOut', () => {
    const params: NotionSetTokenParams = { token: 'ntn_live' }
    const setResult: RpcMethodMap['notion.setToken']['result'] = { ok: true }
    const signOutResult: RpcMethodMap['notion.signOut']['result'] = { ok: true }
    const listResult: RpcMethodMap['notion.listRecents']['result'] = { status: 'ok', items: [] }
    expect(params.token).toBe('ntn_live')
    expect(setResult.ok).toBe(true)
    expect(signOutResult.ok).toBe(true)
    expect(listResult.status).toBe('ok')
  })

  it('carries rate_limited through the shared error shape', () => {
    const err: RpcErrorShape = {
      code: -32000,
      message: 'Notion is rate-limiting requests.',
      data: { code: 'rate_limited' }
    }
    expect(err.data?.code).toBe('rate_limited')
  })
})
