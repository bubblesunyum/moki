import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import type { DayUsageResult, DayUsageWindow } from '../../../../../packages/protocol/src/index'

const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const USAGE_TTL_MS = 60_000
const USAGE_TIMEOUT_MS = 15_000

let cached: { at: number; result: DayUsageResult } | null = null

export function clearUsageCache(): void {
  cached = null
}

/* Credential rule: $OPENCODE_DB, then $XDG_DATA_HOME/opencode/opencode.db,
 * then ~/.local/share/opencode/opencode.db. The sqlite `value` cell is JSON
 * with a `.key`; auth.json maps integration ids to `{ key }`. Never logged. */
export function credentialDbPaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const paths: string[] = []
  if (env['OPENCODE_DB']) paths.push(env['OPENCODE_DB'])
  const xdg = env['XDG_DATA_HOME']
  if (xdg) paths.push(join(xdg, 'opencode', 'opencode.db'))
  paths.push(join(home, '.local', 'share', 'opencode', 'opencode.db'))
  return paths
}

export function authJsonPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const xdg = env['XDG_DATA_HOME']
  const base = xdg ? join(xdg, 'opencode') : join(home, '.local', 'share', 'opencode')
  return join(base, 'auth.json')
}

/** Parse the sqlite `value` cell (JSON with `.key`). Null when unusable. */
export function pickKeyFromDbValue(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { key?: unknown }
    return typeof parsed.key === 'string' && parsed.key !== '' ? parsed.key : null
  } catch {
    return null
  }
}

/** Parse auth.json: `{ "opencode-go": { "key": "…" } }`. */
export function pickKeyFromAuthJson(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const entry = parsed['opencode-go'] as { key?: unknown } | undefined
    return typeof entry?.key === 'string' && entry.key !== '' ? entry.key : null
  } catch {
    return null
  }
}

function runSqlite(dbPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'sqlite3',
      ['--readonly', dbPath, "SELECT value FROM credential WHERE integration_id='opencode-go' ORDER BY active DESC, rowid DESC LIMIT 1;"],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve(null)
          return
        }
        resolve(stdout.trim() === '' ? null : stdout.trim())
      }
    )
  })
}

export async function loadCredentialKey(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): Promise<string | null> {
  for (const db of credentialDbPaths(env, home)) {
    const value = await runSqlite(db)
    const key = pickKeyFromDbValue(value)
    if (key) return key
  }
  try {
    const raw = await fs.readFile(authJsonPath(env, home), 'utf8')
    const key = pickKeyFromAuthJson(raw)
    if (key) return key
  } catch {
    /* No auth.json — reported as missing-login downstream. */
  }
  return null
}

/* Tolerant window mapping: accept `percent` directly, or derive it from
 * `used`/`limit`; accept `resetsAt`/`resetAt`/`resetIn`. Unknown shapes are
 * dropped (the window stays undefined) rather than invented. */
export function mapUsageWindow(raw: unknown): DayUsageWindow | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  let percent: number | undefined
  if (typeof obj['percent'] === 'number' && Number.isFinite(obj['percent'])) {
    percent = obj['percent']
  } else if (typeof obj['used'] === 'number' && typeof obj['limit'] === 'number' && obj['limit'] > 0) {
    percent = (obj['used'] / obj['limit']) * 100
  }
  if (percent === undefined) return undefined
  const resetsRaw = obj['resetsAt'] ?? obj['resetAt'] ?? obj['resetIn'] ?? null
  const resetsAt = typeof resetsRaw === 'string' && resetsRaw !== '' ? resetsRaw : null
  const limited = typeof obj['limited'] === 'boolean' ? obj['limited'] : undefined
  return { percent: Math.round(percent * 10) / 10, resetsAt, ...(limited !== undefined ? { limited } : {}) }
}

export function mapUsagePayload(payload: unknown): {
  rolling?: DayUsageWindow
  weekly?: DayUsageWindow
  monthly?: DayUsageWindow
} {
  if (typeof payload !== 'object' || payload === null) return {}
  const root = (payload as { usage?: unknown }).usage ?? payload
  if (typeof root !== 'object' || root === null) return {}
  const rec = root as Record<string, unknown>
  const out: { rolling?: DayUsageWindow; weekly?: DayUsageWindow; monthly?: DayUsageWindow } = {}
  const rolling = mapUsageWindow(rec['rolling'])
  const weekly = mapUsageWindow(rec['weekly'])
  const monthly = mapUsageWindow(rec['monthly'])
  if (rolling) out.rolling = rolling
  if (weekly) out.weekly = weekly
  if (monthly) out.monthly = monthly
  return out
}

export interface UsageFetchDeps {
  loadKey?: () => Promise<string | null>
  fetchJson?: (key: string) => Promise<{ status: number; body: unknown }>
  now?: () => number
}

async function defaultFetchJson(key: string): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), USAGE_TIMEOUT_MS)
  try {
    const res = await fetch(USAGE_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'User-Agent': 'Moki' },
      signal: ctrl.signal
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchUsage(deps: UsageFetchDeps = {}): Promise<DayUsageResult> {
  const now = deps.now ?? Date.now
  if (cached && now() - cached.at < USAGE_TTL_MS) return cached.result
  const loadKey = deps.loadKey ?? loadCredentialKey
  let key: string | null = null
  try {
    key = await loadKey()
  } catch {
    key = null
  }
  if (!key) {
    const result: DayUsageResult = { status: 'missing-login' }
    return result
  }
  const fetchJson = deps.fetchJson ?? defaultFetchJson
  try {
    const { status, body } = await fetchJson(key)
    if (status === 401 || status === 403) {
      const result: DayUsageResult = { status: 'missing-login' }
      return result
    }
    if (status < 200 || status >= 300) throw new Error(`usage HTTP ${status}`)
    const windows = mapUsagePayload(body)
    if (!windows.rolling && !windows.weekly && !windows.monthly) throw new Error('empty usage payload')
    const result: DayUsageResult = { status: 'live', ...windows }
    cached = { at: now(), result }
    return result
  } catch {
    const lastGood =
      cached?.result.status === 'live'
        ? {
            rolling: cached.result.rolling,
            weekly: cached.result.weekly,
            monthly: cached.result.monthly
          }
        : undefined
    return { status: 'unavailable', ...(lastGood ? { lastGood } : {}) }
  }
}
