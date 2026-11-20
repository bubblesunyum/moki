import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  copyDbToTemp,
  findZenCookiesDb,
  groupForHost,
  importPlannedCookies,
  mapSameSite,
  planCookie,
  readCookieRows,
  removeTempCopy,
  runZenCookieImport,
  setupZenCookieImport,
  ZEN_COOKIES_CHANNEL,
  type PlannableCookie,
  type ZenCookieRow
} from './zenCookies'

/* Fixture values are fake — never the real profile. */

function row(overrides: Partial<ZenCookieRow> = {}): ZenCookieRow {
  return {
    name: 'SID',
    value: 'fake-session-value',
    host: '.google.com',
    path: '/',
    expiry: 1900000000,
    isSecure: true,
    isHttpOnly: true,
    sameSite: 1,
    isPartitioned: false,
    ...overrides
  }
}

function makeJar(failOn: ReadonlySet<string> = new Set()): {
  jar: { cookies: { set: (d: PlannableCookie['details']) => Promise<void> } }
  seen: PlannableCookie['details'][]
} {
  const seen: PlannableCookie['details'][] = []
  return {
    seen,
    jar: {
      cookies: {
        set: async (d: PlannableCookie['details']): Promise<void> => {
          if (failOn.has(d.name)) throw new Error('denied')
          seen.push({ ...d })
        }
      }
    }
  }
}

describe('groupForHost', () => {
  it.each([
    ['.google.com', 'google'],
    ['accounts.google.com', 'google'],
    ['drive.google.com', 'google'],
    ['docs.google.com', 'google'],
    ['GOOGLE.COM', 'google'],
    ['.notion.so', 'notion'],
    ['www.notion.so', 'notion'],
    ['notion.com', 'notion'],
    ['.app.notion.com', 'notion'],
    ['craft.do', 'craft'],
    ['.craft.do', 'craft'],
    ['docs.craft.do', 'craft']
  ])('allows %s as %s', (host, group) => {
    expect(groupForHost(host)).toBe(group)
  })

  it.each([['github.com'], ['evilgoogle.com'], ['google.com.evil.com'], ['notion.so.evil.com'], ['mycraft.do'], [''], ['...']])(
    'rejects %s',
    (host) => {
      expect(groupForHost(host)).toBeNull()
    }
  )
})

describe('mapSameSite', () => {
  it('maps Firefox integers to Electron values', () => {
    expect(mapSameSite(0)).toBe('no_restriction')
    expect(mapSameSite(1)).toBe('lax')
    expect(mapSameSite(2)).toBe('strict')
    expect(mapSameSite(256)).toBe('unspecified')
    expect(mapSameSite(99)).toBe('unspecified')
  })
})

describe('planCookie', () => {
  it('keeps domain on domain cookies and omits it on host-only ones', () => {
    const domain = planCookie(row({ host: '.google.com' }))
    expect('planned' in domain && domain.planned.details.domain).toBe('.google.com')
    const hostOnly = planCookie(row({ host: 'accounts.google.com' }))
    expect('planned' in hostOnly && hostOnly.planned.details.domain).toBeUndefined()
  })

  it('builds an https url from host and path', () => {
    const decision = planCookie(row({ host: '.docs.google.com', path: '/a/b' }))
    expect('planned' in decision && decision.planned.details.url).toBe('https://docs.google.com/a/b')
  })

  it('maps expiry 0 to a session cookie and passes real expiries through', () => {
    const session = planCookie(row({ expiry: 0 }))
    expect('planned' in session && session.planned.details.expirationDate).toBeUndefined()
    const dated = planCookie(row({ expiry: 1900000000 }))
    expect('planned' in dated && dated.planned.details.expirationDate).toBe(1900000000)
  })

  it('preserves secure/httpOnly and maps sameSite', () => {
    const decision = planCookie(row({ isSecure: true, isHttpOnly: false, sameSite: 0 }))
    expect('planned' in decision && decision.planned.details).toMatchObject({
      secure: true,
      httpOnly: false,
      sameSite: 'no_restriction'
    })
  })

  it('accepts a compliant __Host- cookie and skips violations', () => {
    const ok = planCookie(row({ name: '__Host-SID', host: 'accounts.google.com', path: '/', isSecure: true }))
    expect('planned' in ok).toBe(true)
    for (const bad of [
      row({ name: '__Host-SID', host: 'accounts.google.com', path: '/', isSecure: false }),
      row({ name: '__Host-SID', host: '.google.com', path: '/', isSecure: true }),
      row({ name: '__Host-SID', host: 'accounts.google.com', path: '/x', isSecure: true })
    ]) {
      const decision = planCookie(bad)
      expect('skipped' in decision && decision.skipped).toBe('host-prefix-violation')
    }
  })

  it('skips empty names, off-allowlist hosts, partitioned and bad hosts', () => {
    expect(planCookie(row({ name: '' }))).toEqual({ skipped: 'empty-name' })
    expect(planCookie(row({ host: '.github.com' }))).toEqual({ skipped: 'host-not-allowlisted' })
    expect(planCookie(row({ isPartitioned: true }))).toEqual({ skipped: 'partitioned' })
    expect(planCookie(row({ host: '' }))).toEqual({ skipped: 'host-not-allowlisted' })
  })
})

describe('importPlannedCookies', () => {
  const planned = (group: PlannableCookie['group'], name: string): PlannableCookie => ({
    group,
    details: { url: 'https://example.com/', name, value: 'fake', secure: true }
  })

  it('sets every cookie and marks groups ok', async () => {
    const { jar, seen } = makeJar()
    const result = await importPlannedCookies(jar, [
      planned('google', 'a'),
      planned('notion', 'b'),
      planned('craft', 'c')
    ])
    expect(seen.map((d) => d.name)).toEqual(['a', 'b', 'c'])
    expect(result).toEqual({ groups: { google: 'ok', notion: 'ok', craft: 'ok' }, imported: 3 })
  })

  it('isolates a failing group and keeps going', async () => {
    const { jar } = makeJar(new Set(['bad']))
    const result = await importPlannedCookies(jar, [planned('google', 'bad'), planned('notion', 'good')])
    expect(result.groups).toEqual({ google: 'failed', notion: 'ok', craft: 'failed' })
    expect(result.imported).toBe(1)
  })

  it('is idempotent: re-import settles on the same jar', async () => {
    const { jar, seen } = makeJar()
    const batch = [planned('google', 'a'), planned('craft', 'b')]
    const first = await importPlannedCookies(jar, batch)
    const second = await importPlannedCookies(jar, batch)
    expect(second).toEqual(first)
    expect(seen).toHaveLength(4)
  })
})

describe('runZenCookieImport', () => {
  const rows: ZenCookieRow[] = [
    row({ name: 'SID', host: '.google.com' }),
    row({ name: 'token_v2', host: '.notion.so' }),
    row({ name: 'sid', host: '.craft.do' })
  ]

  function depsWithRows(jar: { cookies: { set: (d: never) => Promise<void> } }, extra: Record<string, unknown> = {}) {
    const removed: string[] = []
    return {
      removed,
      deps: {
        getJar: () => jar,
        copyDb: (_src: string): string => 'copied.sqlite',
        readRows: (_tmp: string): ZenCookieRow[] => rows,
        removeTemp: (p: string): void => {
          removed.push(p)
        },
        ...extra
      }
    }
  }

  it('imports all three host groups and cleans up the temp copy', async () => {
    const { jar } = makeJar()
    const { deps, removed } = depsWithRows(jar as never)
    // findZenCookiesDb needs a real home; inject via a temp profile below instead.
    const home = mkdtempSync(join(tmpdir(), 'moki-zen-home-'))
    try {
      const profile = join(home, 'Library', 'Application Support', 'Zen', 'Profiles', 'abc.Default')
      const { mkdirSync, writeFileSync } = await import('node:fs')
      mkdirSync(profile, { recursive: true })
      writeFileSync(join(profile, 'cookies.sqlite'), 'stub')
      const status = await runZenCookieImport({ ...deps, homeDir: home })
      expect(status.groups).toEqual({ google: 'ok', notion: 'ok', craft: 'ok' })
      expect(status.imported).toBe(3)
      expect(status.skipped).toBe(0)
      expect(removed).toEqual(['copied.sqlite'])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('returns all-failed without Zen installed and never throws', async () => {
    const { jar } = makeJar()
    const home = mkdtempSync(join(tmpdir(), 'moki-zen-empty-'))
    try {
      const status = await runZenCookieImport({ getJar: () => jar as never, homeDir: home })
      expect(status).toEqual({ groups: { google: 'failed', notion: 'failed', craft: 'failed' }, imported: 0, skipped: 0 })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('returns all-failed when there is no session', async () => {
    const status = await runZenCookieImport({ getJar: () => null })
    expect(status.groups).toEqual({ google: 'failed', notion: 'failed', craft: 'failed' })
  })
})

describe('setupZenCookieImport', () => {
  it('registers the channel and returns status with no cookie material', async () => {
    const { jar } = makeJar()
    let handler: (() => Promise<unknown>) | null = null
    const ipcMain = {
      handle: (channel: string, cb: () => Promise<unknown>): void => {
        if (channel === ZEN_COOKIES_CHANNEL) handler = cb
      }
    }
    const home = mkdtempSync(join(tmpdir(), 'moki-zen-ipc-'))
    try {
      const profile = join(home, 'Library', 'Application Support', 'Zen', 'Profiles', 'abc.Default')
      const { mkdirSync, writeFileSync } = await import('node:fs')
      mkdirSync(profile, { recursive: true })
      writeFileSync(join(profile, 'cookies.sqlite'), 'stub')
      setupZenCookieImport(ipcMain as never, {
        getJar: () => jar as never,
        homeDir: home,
        copyDb: () => 'copied.sqlite',
        readRows: () => [row({ name: 'SID', value: 'fake-secret', host: '.google.com' })],
        removeTemp: () => {}
      })
      expect(handler).not.toBeNull()
      const status = JSON.stringify(await handler!())
      expect(status).toContain('"google":"ok"')
      expect(status).not.toContain('fake-secret')
      expect(status).not.toContain('SID')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('findZenCookiesDb + copyDbToTemp', () => {
  it('finds the Default profile db and copies it byte-identical', async () => {
    const home = mkdtempSync(join(tmpdir(), 'moki-zen-find-'))
    try {
      const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs')
      const profile = join(home, 'Library', 'Application Support', 'Zen', 'Profiles', 'xyz.Default (release)')
      mkdirSync(profile, { recursive: true })
      writeFileSync(join(profile, 'cookies.sqlite'), 'locked-db-bytes')
      const found = findZenCookiesDb(home)
      expect(found).toBe(join(profile, 'cookies.sqlite'))
      const tmp = copyDbToTemp(found!)
      try {
        expect(readFileSync(tmp, 'utf8')).toBe('locked-db-bytes')
      } finally {
        removeTempCopy(tmp)
      }
      // The unique staging dir goes away with the copy — no litter.
      expect(existsSync(dirname(tmp))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
    expect(findZenCookiesDb(mkdtempSync(join(tmpdir(), 'moki-zen-none-')))).toBeNull()
  })

  it('picks the most-recently-modified Default dir, never alphabetical-first', async () => {
    const home = mkdtempSync(join(tmpdir(), 'moki-zen-mtime-'))
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs')
      const profiles = join(home, 'Library', 'Application Support', 'Zen', 'Profiles')
      const stale = join(profiles, 'aaa.Default')
      const live = join(profiles, 'zzz.Default (release)')
      mkdirSync(stale, { recursive: true })
      mkdirSync(live, { recursive: true })
      writeFileSync(join(stale, 'cookies.sqlite'), 'stale-bytes')
      writeFileSync(join(live, 'cookies.sqlite'), 'live-bytes')
      // Stale sorts first alphabetically but was written a day earlier.
      const old = new Date('2026-01-01T00:00:00Z')
      const now = new Date('2026-11-20T00:00:00Z')
      utimesSync(stale, old, old)
      utimesSync(live, now, now)
      expect(findZenCookiesDb(home)).toBe(join(live, 'cookies.sqlite'))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('prefers the profiles.ini Default profile over the newest dir', async () => {
    const home = mkdtempSync(join(tmpdir(), 'moki-zen-ini-'))
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs')
      const profiles = join(home, 'Library', 'Application Support', 'Zen', 'Profiles')
      const older = join(profiles, 'aaa.Default')
      const newer = join(profiles, 'zzz.Default (release)')
      mkdirSync(older, { recursive: true })
      mkdirSync(newer, { recursive: true })
      writeFileSync(join(older, 'cookies.sqlite'), 'default-bytes')
      writeFileSync(join(newer, 'cookies.sqlite'), 'newer-bytes')
      const old = new Date('2026-01-01T00:00:00Z')
      const now = new Date('2026-11-20T00:00:00Z')
      utimesSync(older, old, old)
      utimesSync(newer, now, now)
      writeFileSync(
        join(profiles, 'profiles.ini'),
        '[Profile0]\nName=default\nIsRelative=1\nPath=aaa.Default\nDefault=1\n\n' +
          '[Profile1]\nName=release\nIsRelative=1\nPath=zzz.Default (release)\n'
      )
      expect(findZenCookiesDb(home)).toBe(join(older, 'cookies.sqlite'))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('ignores a profiles.ini Default entry with no cookies.sqlite', async () => {
    const home = mkdtempSync(join(tmpdir(), 'moki-zen-ini-miss-'))
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs')
      const profiles = join(home, 'Library', 'Application Support', 'Zen', 'Profiles')
      const live = join(profiles, 'zzz.Default (release)')
      mkdirSync(live, { recursive: true })
      writeFileSync(join(live, 'cookies.sqlite'), 'live-bytes')
      writeFileSync(join(profiles, 'profiles.ini'), '[Profile0]\nName=gone\nIsRelative=1\nPath=gone.Default\nDefault=1\n')
      expect(findZenCookiesDb(home)).toBe(join(live, 'cookies.sqlite'))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('double import gets unique temp paths (no same-ms collision)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'moki-zen-dbl-'))
    try {
      const { writeFileSync } = await import('node:fs')
      const src = join(dir, 'cookies.sqlite')
      writeFileSync(src, 'locked-db-bytes')
      const first = copyDbToTemp(src, dir)
      const second = copyDbToTemp(src, dir)
      try {
        expect(second).not.toBe(first)
      } finally {
        removeTempCopy(first)
        removeTempCopy(second)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('readCookieRows against a fixture sqlite DB', () => {
  it('reads moz_cookies rows end to end (skipped without node:sqlite)', async () => {
    let DatabaseSync: new (path: string) => {
      exec: (sql: string) => void
      close: () => void
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ;({ DatabaseSync } = require('node:sqlite') as {
        DatabaseSync: new (path: string) => { exec: (sql: string) => void; close: () => void }
      })
    } catch {
      return
    }
    const dir = mkdtempSync(join(tmpdir(), 'moki-zen-fixture-'))
    try {
      const dbPath = join(dir, 'cookies.sqlite')
      const db = new DatabaseSync(dbPath)
      db.exec(`CREATE TABLE moz_cookies(
        id INTEGER PRIMARY KEY, originAttributes TEXT NOT NULL DEFAULT '',
        name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,
        lastAccessed INTEGER, creationTime INTEGER, isSecure INTEGER,
        isHttpOnly INTEGER, inBrowserElement INTEGER, sameSite INTEGER,
        schemeMap INTEGER, isPartitionedAttributeSet INTEGER, updateTime INTEGER)`)
      db.exec(`INSERT INTO moz_cookies
        (name, value, host, path, expiry, isSecure, isHttpOnly, sameSite, isPartitionedAttributeSet)
        VALUES ('SID','fake-google-session','.google.com','/',1900000000,1,1,1,0),
               ('__Host-SID','fake-host-session','accounts.google.com','/',1900000000,1,1,2,0),
               ('token_v2','fake-notion-session','.notion.so','/',0,1,1,0,0),
               ('sid','fake-craft-session','.craft.do','/',1900000000,1,1,256,0),
               ('other','fake-other','.github.com','/',1900000000,1,1,1,0)`)
      db.close()
      const copied = copyDbToTemp(dbPath)
      try {
        const rows = readCookieRows(copied)
        expect(rows).toHaveLength(5)
        const { jar, seen } = makeJar()
        const planned: PlannableCookie[] = []
        let skipped = 0
        for (const r of rows) {
          const decision = planCookie(r)
          if ('planned' in decision) planned.push(decision.planned)
          else skipped += 1
        }
        expect(skipped).toBe(1)
        const result = await importPlannedCookies(jar, planned)
        expect(result.groups).toEqual({ google: 'ok', notion: 'ok', craft: 'ok' })
        expect(result.imported).toBe(4)
        expect(seen.map((d) => d.value).sort()).toEqual(
          ['fake-craft-session', 'fake-google-session', 'fake-host-session', 'fake-notion-session'].sort()
        )
        /* Session-cookie mapping held for the expiry=0 row. */
        expect(seen.find((d) => d.name === 'token_v2')?.expirationDate).toBeUndefined()
      } finally {
        removeTempCopy(copied)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maps injected loader records through rowFromRecord defaults', () => {
    const rows = readCookieRows('unused.sqlite', {
      loadDatabase: () => ({
        rows: [
          { name: 'a', value: 'v', host: '.google.com', path: '', expiry: 0, isSecure: 1, isHttpOnly: 0, sameSite: 0, isPartitionedAttributeSet: 0 },
          { name: null, value: null, host: null, path: null, expiry: null, isSecure: null, isHttpOnly: null, sameSite: null, isPartitionedAttributeSet: null }
        ],
        close: () => {}
      })
    })
    expect(rows[0]).toMatchObject({ name: 'a', path: '/', isSecure: true, sameSite: 0 })
    expect(rows[1]).toMatchObject({ name: '', host: '', path: '/' })
  })
})
