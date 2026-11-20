import { describe, expect, it } from 'vitest'
import {
  clearUsageCache,
  fetchUsage,
  mapUsagePayload,
  mapUsageWindow,
  pickKeyFromAuthJson,
  pickKeyFromDbValue
} from './usage'

describe('pickKeyFromDbValue', () => {
  it('reads .key from the sqlite JSON cell', () => {
    expect(pickKeyFromDbValue(JSON.stringify({ key: 'abc' }))).toBe('abc')
    expect(pickKeyFromDbValue('not json')).toBeNull()
    expect(pickKeyFromDbValue(JSON.stringify({ key: '' }))).toBeNull()
    expect(pickKeyFromDbValue(null)).toBeNull()
  })
})

describe('pickKeyFromAuthJson', () => {
  it('reads the opencode-go entry', () => {
    expect(pickKeyFromAuthJson(JSON.stringify({ 'opencode-go': { key: 'k1' } }))).toBe('k1')
    expect(pickKeyFromAuthJson(JSON.stringify({ other: { key: 'k2' } }))).toBeNull()
    expect(pickKeyFromAuthJson('{{{')).toBeNull()
  })
})

describe('mapUsageWindow', () => {
  it('passes percent through and derives it from used/limit', () => {
    expect(mapUsageWindow({ percent: 62.34, resetsAt: '2026-01-01T00:00:00Z' })?.percent).toBe(62.3)
    expect(mapUsageWindow({ used: 31, limit: 50, resetAt: 'x', limited: true })).toEqual({
      percent: 62,
      resetsAt: 'x',
      limited: true
    })
    expect(mapUsageWindow({ nope: 1 })).toBeUndefined()
    expect(mapUsageWindow(null)).toBeUndefined()
  })
})

describe('mapUsagePayload', () => {
  it('maps rolling/weekly/monthly from usage or a bare object', () => {
    const payload = {
      usage: {
        rolling: { percent: 10, resetsAt: 'r' },
        weekly: { percent: 20, resetsAt: 'w' },
        monthly: { percent: 30, resetsAt: 'm' }
      }
    }
    const mapped = mapUsagePayload(payload)
    expect(mapped.rolling?.percent).toBe(10)
    expect(mapped.weekly?.resetsAt).toBe('w')
    expect(mapped.monthly?.percent).toBe(30)
    expect(mapUsagePayload({ garbage: true })).toEqual({})
  })
})

describe('fetchUsage', () => {
  it('reports missing-login without a credential', async () => {
    clearUsageCache()
    const result = await fetchUsage({ loadKey: async () => null, now: () => 0 })
    expect(result.status).toBe('missing-login')
  })

  it('reports missing-login on 401 and unavailable on failure', async () => {
    clearUsageCache()
    await expect(
      fetchUsage({ loadKey: async () => 'k', fetchJson: async () => ({ status: 401, body: {} }), now: () => 0 })
    ).resolves.toMatchObject({ status: 'missing-login' })
    clearUsageCache()
    await expect(
      fetchUsage({
        loadKey: async () => 'k',
        fetchJson: async () => {
          throw new Error('down')
        },
        now: () => 0
      })
    ).resolves.toMatchObject({ status: 'unavailable' })
  })

  it('caches live snapshots for 60s', async () => {
    clearUsageCache()
    let calls = 0
    const deps = {
      loadKey: async () => 'k',
      fetchJson: async () => {
        calls += 1
        return { status: 200, body: { usage: { rolling: { percent: 5, resetsAt: null } } } }
      },
      now: () => 1000
    }
    const first = await fetchUsage(deps)
    const second = await fetchUsage({ ...deps, now: () => 1000 + 10_000 })
    expect(first.status).toBe('live')
    expect(second.status).toBe('live')
    expect(calls).toBe(1)
    clearUsageCache()
  })
})
