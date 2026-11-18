import { spawn as nodeSpawn } from 'node:child_process'
import { LineBuffer } from './lineBuffer'

export type HelperStatus = 'starting' | 'ok' | 'down'

export interface WritableLike {
  write(data: string): boolean
}

export interface ReadableLike {
  on(event: 'data', cb: (chunk: unknown) => void): void
}

export interface ChildLike {
  stdin?: WritableLike | null
  stdout?: ReadableLike | null
  stderr?: ReadableLike | null
  on(event: 'exit' | 'error' | 'close', cb: (...args: any[]) => void): void
  kill(signal?: NodeJS.Signals): void
  pid?: number
}

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv }
) => ChildLike

export interface Logger {
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface HelperProcessOptions {
  binaryPath: string
  timeoutMs?: number
  initialRestartDelayMs?: number
  maxRestartDelayMs?: number
  spawnFn?: SpawnFn
  logger?: Logger
  env?: NodeJS.ProcessEnv
}

export class HelperRpcError extends Error {
  code: number
  data?: { code?: string }

  constructor(code: number, message: string, data?: { code?: string }) {
    super(message)
    this.name = 'HelperRpcError'
    this.code = code
    if (data !== undefined) this.data = data
  }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  payload: string
  sent: boolean
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_INITIAL_RESTART_MS = 200
const DEFAULT_MAX_RESTART_MS = 5_000

/** Spawns the Swift helper, speaks newline-delimited JSON-RPC over stdio. */
export class HelperProcess {
  private readonly binaryPath: string
  private readonly timeoutMs: number
  private readonly initialRestartDelayMs: number
  private readonly maxRestartDelayMs: number
  private readonly spawnFn: SpawnFn
  private readonly logger: Logger
  private readonly env: NodeJS.ProcessEnv | undefined

  private child: ChildLike | null = null
  private readonly lines = new LineBuffer()
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private status: HelperStatus = 'starting'
  private readonly statusListeners = new Set<(s: HelperStatus) => void>()
  private readonly notificationListeners = new Set<(method: string, params: unknown) => void>()
  private restartAttempts = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(opts: HelperProcessOptions) {
    this.binaryPath = opts.binaryPath
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.initialRestartDelayMs = opts.initialRestartDelayMs ?? DEFAULT_INITIAL_RESTART_MS
    this.maxRestartDelayMs = opts.maxRestartDelayMs ?? DEFAULT_MAX_RESTART_MS
    this.spawnFn = opts.spawnFn ?? (nodeSpawn as unknown as SpawnFn)
    this.logger = opts.logger ?? console
    this.env = opts.env
  }

  getStatus(): HelperStatus {
    return this.status
  }

  onStatus(cb: (s: HelperStatus) => void): () => void {
    this.statusListeners.add(cb)
    return () => {
      this.statusListeners.delete(cb)
    }
  }

  onNotification(cb: (method: string, params: unknown) => void): () => void {
    this.notificationListeners.add(cb)
    return () => {
      this.notificationListeners.delete(cb)
    }
  }

  start(): void {
    if (this.disposed || this.child) return
    let child: ChildLike
    try {
      child = this.spawnFn(this.binaryPath, [], { env: this.env ?? process.env })
    } catch (err) {
      this.logger.error(`[helper] spawn failed: ${String(err)}`)
      this.setStatus('down')
      this.scheduleRestart()
      return
    }
    this.child = child

    child.stdout?.on('data', (chunk) => {
      if (this.child !== child) return
      this.handleChunk(String(chunk))
    })
    child.stderr?.on('data', (chunk) => {
      this.logger.error(`[helper:stderr] ${String(chunk).trimEnd()}`)
    })
    child.on('exit', () => {
      this.handleExit(child)
    })
    child.on('error', (err) => {
      this.logger.error(`[helper] process error: ${String(err)}`)
      this.handleExit(child)
    })
    this.flush()
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error('helper disposed'))
    }
    const id = this.nextId++
    const payload =
      `${JSON.stringify(params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params })}\n`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`helper call timed out: ${method}`))
      }, this.timeoutMs)
      if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
        ;(timer as unknown as { unref: () => void }).unref()
      }
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
        payload,
        sent: false
      })
      if (!this.child && !this.restartTimer) {
        this.start()
      }
      this.flush()
    })
  }

  dispose(): void {
    this.disposed = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('helper disposed'))
    }
    this.pending.clear()
    try {
      this.child?.kill('SIGTERM')
    } catch {
      // already gone
    }
    this.child = null
  }

  /** Visible for tests: feed one stdout line through the dispatcher. */
  handleLineForTest(line: string): void {
    this.handleLine(line)
  }

  private handleChunk(chunk: string): void {
    for (const line of this.lines.push(chunk)) {
      this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: {
      id?: number | string | null
      result?: unknown
      error?: { code?: number; message?: string; data?: { code?: string } }
      method?: unknown
      params?: unknown
    }
    try {
      msg = JSON.parse(trimmed) as typeof msg
    } catch {
      this.logger.warn(`[helper] ignoring non-JSON line: ${trimmed.slice(0, 200)}`)
      return
    }

    if (typeof msg.method === 'string' && msg.id === undefined) {
      for (const cb of this.notificationListeners) {
        cb(msg.method, msg.params)
      }
      return
    }

    if (msg.id !== undefined && msg.id !== null) {
      const key = typeof msg.id === 'number' ? msg.id : Number(msg.id)
      const entry = this.pending.get(key)
      if (!entry) return
      this.pending.delete(key)
      clearTimeout(entry.timer)
      if (msg.error) {
        entry.reject(
          new HelperRpcError(
            typeof msg.error.code === 'number' ? msg.error.code : -32603,
            typeof msg.error.message === 'string' ? msg.error.message : 'helper error',
            msg.error.data
          )
        )
      } else {
        entry.resolve(msg.result)
        this.markHealthy()
      }
      return
    }
  }

  private markHealthy(): void {
    this.restartAttempts = 0
    this.setStatus('ok')
  }

  private setStatus(next: HelperStatus): void {
    if (this.status === next) return
    this.status = next
    for (const cb of this.statusListeners) {
      cb(next)
    }
  }

  private flush(): void {
    const stdin = this.child?.stdin
    if (!stdin) return
    for (const [id, entry] of this.pending) {
      if (entry.sent) continue
      try {
        stdin.write(entry.payload)
        entry.sent = true
      } catch (err) {
        clearTimeout(entry.timer)
        this.pending.delete(id)
        entry.reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  private handleExit(exited: ChildLike): void {
    if (this.child !== exited) return
    this.child = null
    this.lines.clear()
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('helper exited'))
    }
    this.pending.clear()
    if (this.disposed) return
    this.setStatus('down')
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (this.disposed || this.restartTimer) return
    const delay = Math.min(
      this.initialRestartDelayMs * 2 ** this.restartAttempts,
      this.maxRestartDelayMs
    )
    this.restartAttempts += 1
    this.logger.warn(`[helper] restarting in ${delay}ms (attempt ${this.restartAttempts})`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.start()
    }, delay)
    if (typeof (this.restartTimer as unknown as { unref?: () => void }).unref === 'function') {
      ;(this.restartTimer as unknown as { unref: () => void }).unref()
    }
  }
}
