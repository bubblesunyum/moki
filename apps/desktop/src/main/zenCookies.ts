import { copyFileSync, existsSync, readdirSync, rmSync, statSync, readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir, homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { IpcMain } from 'electron'
import {
  SHARED_WEB_SESSION_PARTITION,
  ZEN_COOKIES_CHANNEL,
  failedImportStatus,
  type ZenCookieImportStatus,
  type ZenGroupState,
  type ZenHostGroup
} from './zenCookies.shared'

export { SHARED_WEB_SESSION_PARTITION, ZEN_COOKIES_CHANNEL }

/* One-shot import of the user's Zen (Firefox-family) profile cookies into
 * the shared `persist:moki-websites` session, so Docs previews start signed
 * in instead of showing a login wall.
 *
 * Live cookies.sqlite is LOCKED while Zen runs, so the DB is copied to a
 * temp file first and never opened in place. Only google/drive/docs,
 * notion.so/notion.com and craft.do hosts are imported; everything else is
 * left alone. Cookie values are secrets: they stay in main-process memory,
 * never reach logs, stdout, or the renderer (status is ok/failed + counts).
 *
 * Re-import is idempotent — session.cookies.set overwrites, so running
 * twice settles on the same jar. Double sign-in inside the guest remains
 * the fallback for anything this misses. */

/* Raw row shape from moz_cookies. `value` is secret — keep it in main. */
export interface ZenCookieRow {
  name: string
  value: string
  host: string
  path: string
  expiry: number
  isSecure: boolean
  isHttpOnly: boolean
  sameSite: number
  isPartitioned: boolean
}

export type ElectronSameSite = 'unspecified' | 'no_restriction' | 'lax' | 'strict'

/* Structural subset of Electron's CookiesSetDetails — injected so tests
 * never need a real session. */
export interface CookieSetter {
  set(details: {
    url: string
    name: string
    value: string
    domain?: string
    path?: string
    secure?: boolean
    httpOnly?: boolean
    sameSite?: ElectronSameSite
    expirationDate?: number
  }): Promise<void>
}

export interface CookiesJar {
  cookies: CookieSetter
}

/* Firefox moz_cookies.sameSite, verified against a live Zen profile:
 * 0 appears only on Secure cookies (None requires Secure), 1/2 are mixed
 * (Lax/Strict), and 256 is a mixed bag (unset). Anything else → unspecified
 * and let Chromium apply its default. */
export function mapSameSite(sameSite: number): ElectronSameSite {
  switch (sameSite) {
    case 0:
      return 'no_restriction'
    case 1:
      return 'lax'
    case 2:
      return 'strict'
    default:
      return 'unspecified'
  }
}

/* Host allowlist, one group per sign-in surface. Leading dots (Firefox
 * domain cookies) and case are normalized before matching. */
export function groupForHost(rawHost: string): ZenHostGroup | null {
  const host = rawHost.trim().toLowerCase().replace(/^\.+/, '')
  if (host === '') return null
  if (host === 'google.com' || host.endsWith('.google.com')) return 'google'
  if (host === 'notion.so' || host.endsWith('.notion.so')) return 'notion'
  if (host === 'notion.com' || host.endsWith('.notion.com') || host === 'notion.site' || host.endsWith('.notion.site')) {
    return 'notion'
  }
  if (host === 'craft.do' || host.endsWith('.craft.do')) return 'craft'
  return null
}

function cookieUrlFor(host: string, path: string): string | null {
  const bare = host.replace(/^\.+/, '')
  if (bare === '' || bare.includes('/') || bare.includes(' ') || bare.includes('\\')) return null
  const safePath = path.startsWith('/') ? path : `/${path}`
  try {
    const url = new URL(`https://${bare}${safePath}`)
    if (url.hostname !== bare) return null
    return url.toString()
  } catch {
    return null
  }
}

export interface PlannableCookie {
  group: ZenHostGroup
  details: {
    url: string
    name: string
    value: string
    domain?: string
    path?: string
    secure?: boolean
    httpOnly?: boolean
    sameSite?: ElectronSameSite
    expirationDate?: number
  }
}

/* Firefox row → Electron set() details, or null with a reason when the
 * cookie must not be set. Reasons are coarse (no names/values) for logs. */
export function planCookie(row: ZenCookieRow): { planned: PlannableCookie } | { skipped: string } {
  if (row.name === '') return { skipped: 'empty-name' }
  const group = groupForHost(row.host)
  if (group === null) return { skipped: 'host-not-allowlisted' }
  if (row.isPartitioned) return { skipped: 'partitioned' }
  const domainCookie = row.host.startsWith('.')
  /* __Host- cookies are only valid as Secure, host-only, Path=/. Anything
   * else would be rejected by Chromium anyway — skip it here instead. */
  if (row.name.startsWith('__Host-')) {
    if (!row.isSecure || row.path !== '/' || domainCookie) return { skipped: 'host-prefix-violation' }
  }
  const url = cookieUrlFor(row.host, row.path)
  if (url === null) return { skipped: 'bad-url' }
  const details: PlannableCookie['details'] = {
    url,
    name: row.name,
    value: row.value,
    path: row.path,
    secure: row.isSecure,
    httpOnly: row.isHttpOnly,
    sameSite: mapSameSite(row.sameSite)
  }
  /* Domain cookies keep their domain so subdomains share them; host-only
   * cookies omit it so only the exact host matches. */
  if (domainCookie) details.domain = row.host
  /* Firefox expiry 0 = session cookie → omit expirationDate so Chromium
   * treats it as session-scoped too. Both are epoch seconds otherwise. */
  if (Number.isFinite(row.expiry) && row.expiry > 0) details.expirationDate = row.expiry
  return { planned: { group, details } }
}

/* Locate the Zen profile's cookies.sqlite. The Default profile wins: first
 * via profiles.ini's `Default=1` section, else the most-recently-modified
 * *Default* dir (mtime — the profile Zen actually writes to), never
 * alphabetical-first (a stale `abc.Default` sorts before the live
 * `xyz.Default (release)`). Null when Zen was never installed — the caller
 * reports all-failed, not an exception. `homeDir` is injectable for tests. */
export function findZenCookiesDb(homeDir: string = homedir()): string | null {
  const profilesDir = join(homeDir, 'Library', 'Application Support', 'Zen', 'Profiles')
  let entries: string[]
  try {
    entries = readdirSync(profilesDir)
  } catch {
    return null
  }
  const dbFor = (dirName: string): string | null => {
    const db = join(profilesDir, dirName, 'cookies.sqlite')
    try {
      return existsSync(db) ? db : null
    } catch {
      return null
    }
  }
  // profiles.ini names the live profile: the section carrying Default=1.
  try {
    const ini = readFileSync(join(profilesDir, 'profiles.ini'), 'utf8')
    const section = ini.split(/^\[.*\]/m).find((body) => /^Default=1\s*$/m.test(body))
    const pathLine = section?.split('\n').find((line) => line.startsWith('Path='))
    const iniDir = pathLine?.slice('Path='.length).trim()
    if (iniDir) {
      const found = dbFor(iniDir)
      if (found) return found
    }
  } catch {
    /* No (or unreadable) profiles.ini — fall through to the mtime pick. */
  }
  const candidates = entries
    .filter((name) => name.toLowerCase().includes('default'))
    .map((name) => {
      let mtimeMs = -1
      try {
        mtimeMs = statSync(join(profilesDir, name)).mtimeMs
      } catch {
        /* Unstatable dir sorts last. */
      }
      return { name, mtimeMs }
    })
    .filter(({ name }) => dbFor(name) !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  const newest = candidates[0]
  return newest ? dbFor(newest.name) : null
}

/* Copy the live DB to a temp file — never open it in place, SQLite takes a
 * lock Zen may hold and the copy fails or blocks. Staged in a fresh mkdtemp
 * dir with a randomUUID name per run, so concurrent imports can never share
 * (or collide on) a half-written copy. Callers remove the file and its
 * staging dir; see runZenCookieImport. */
export function copyDbToTemp(srcPath: string, dir: string = tmpdir()): string {
  const staging = mkdtempSync(join(dir, 'moki-zen-cookies-'))
  const dest = join(staging, `cookies-${randomUUID()}.sqlite`)
  copyFileSync(srcPath, dest)
  return dest
}

/* Remove a temp copy made by copyDbToTemp: the file plus its unique staging
 * dir. Tolerates injected copyDb paths (tests) that never had a staging dir. */
export function removeTempCopy(tmpPath: string): void {
  rmSync(tmpPath, { force: true })
  try {
    const staging = dirname(tmpPath)
    if (basename(staging).startsWith('moki-zen-cookies-')) {
      rmSync(staging, { force: true, recursive: true })
    }
  } catch {
  }
}

const MOZ_COOKIES_SQL = `SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite, isPartitionedAttributeSet FROM moz_cookies`

function rowFromRecord(record: Record<string, unknown>): ZenCookieRow {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    name: str(record['name']),
    value: str(record['value']),
    host: str(record['host']),
    path: str(record['path']) === '' ? '/' : str(record['path']),
    expiry: num(record['expiry']),
    isSecure: num(record['isSecure']) === 1,
    isHttpOnly: num(record['isHttpOnly']) === 1,
    sameSite: num(record['sameSite']),
    isPartitioned: num(record['isPartitionedAttributeSet']) === 1
  }
}

/* Read rows from a (copied) DB. Prefers node:sqlite; falls back to the
 * macOS sqlite3 CLI in JSON mode so values with separators survive. Values
 * stay in memory here — callers must never log them. */
export function readCookieRows(
  dbPath: string,
  deps?: {
    loadDatabase?: (path: string) => { rows: Array<Record<string, unknown>>; close: () => void }
    runCli?: (dbPath: string, sql: string) => string
  }
): ZenCookieRow[] {
  if (deps?.loadDatabase) {
    const db = deps.loadDatabase(dbPath)
    try {
      return db.rows.map(rowFromRecord)
    } finally {
      db.close()
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
        prepare: (sql: string) => { all: () => Array<Record<string, unknown>> }
        close: () => void
      }
    }
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      return db.prepare(MOZ_COOKIES_SQL).all().map(rowFromRecord)
    } finally {
      db.close()
    }
  } catch {
    /* Older runtime without node:sqlite — shell out to the system CLI. */
  }
  const runCli =
    deps?.runCli ??
    ((target: string, sql: string): string => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execFileSync } = require('node:child_process') as {
        execFileSync: (cmd: string, args: string[]) => Buffer
      }
      return execFileSync('sqlite3', ['-json', target, sql]).toString('utf8')
    })
  const parsed = JSON.parse(runCli(dbPath, MOZ_COOKIES_SQL)) as unknown
  if (!Array.isArray(parsed)) return []
  return (parsed as Array<Record<string, unknown>>).map(rowFromRecord)
}

/* Set planned cookies into the jar, one awaited set() each so a single
 * rejection can't abort the rest. Per-group state: 'ok' when at least one
 * cookie landed and none errored, 'failed' otherwise. */
export async function importPlannedCookies(
  jar: CookiesJar,
  planned: PlannableCookie[]
): Promise<Pick<ZenCookieImportStatus, 'groups' | 'imported'>> {
  const setOk: Record<ZenHostGroup, number> = { google: 0, notion: 0, craft: 0 }
  const setFailed: Record<ZenHostGroup, number> = { google: 0, notion: 0, craft: 0 }
  for (const cookie of planned) {
    try {
      await jar.cookies.set(cookie.details)
      setOk[cookie.group] += 1
    } catch {
      setFailed[cookie.group] += 1
    }
  }
  const groups = {
    google: groupState(setOk.google, setFailed.google),
    notion: groupState(setOk.notion, setFailed.notion),
    craft: groupState(setOk.craft, setFailed.craft)
  }
  return { groups, imported: setOk.google + setOk.notion + setOk.craft }
}

function groupState(ok: number, failed: number): ZenGroupState {
  return ok > 0 && failed === 0 ? 'ok' : 'failed'
}

export interface ZenImportDeps {
  homeDir?: string
  getJar?: () => CookiesJar | null
  readRows?: (dbPath: string) => ZenCookieRow[]
  copyDb?: (srcPath: string) => string
  removeTemp?: (path: string) => void
}

function defaultGetJar(): CookiesJar | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as {
      session?: { fromPartition: (partition: string) => CookiesJar }
    }
    if (!electron.session) return null
    return electron.session.fromPartition(SHARED_WEB_SESSION_PARTITION)
  } catch {
    /* Under test there is no Electron runtime — injected jars cover it. */
    return null
  }
}

/* Full one-shot flow: find → copy → read → plan → set. Never throws and
 * never leaks values: missing Zen, a missing session, or any I/O failure
 * all collapse to an all-failed status with zeroed counts. */
export async function runZenCookieImport(deps?: ZenImportDeps): Promise<ZenCookieImportStatus> {
  try {
    const jar = deps?.getJar ? deps.getJar() : defaultGetJar()
    if (jar === null) return failedImportStatus()
    const src = findZenCookiesDb(deps?.homeDir)
    if (src === null) return failedImportStatus()
    const tmp = deps?.copyDb ? deps.copyDb(src) : copyDbToTemp(src)
    try {
      const rows = deps?.readRows ? deps.readRows(tmp) : readCookieRows(tmp)
      const planned: PlannableCookie[] = []
      let skipped = 0
      for (const row of rows) {
        const decision = planCookie(row)
        if ('planned' in decision) planned.push(decision.planned)
        else skipped += 1
      }
      const result = await importPlannedCookies(jar, planned)
      /* Groups the profile had nothing for stay 'failed' so the UI can
       * still offer in-guest sign-in as the fallback. */
      console.log(
        `[zenCookies] import done imported=${result.imported} skipped=${skipped}`
      )
      return { ...result, skipped }
    } finally {
      try {
        if (deps?.removeTemp) deps.removeTemp(tmp)
        else removeTempCopy(tmp)
      } catch {
      }
    }
  } catch {
    return failedImportStatus()
  }
}

/* Orchestrator wiring point: registers the import IPC. The handler returns
 * status only — cookie values never leave main. */
export function setupZenCookieImport(ipcMain: IpcMain, deps?: ZenImportDeps): void {
  ipcMain.handle(ZEN_COOKIES_CHANNEL, async (): Promise<ZenCookieImportStatus> => {
    return runZenCookieImport(deps)
  })
}
