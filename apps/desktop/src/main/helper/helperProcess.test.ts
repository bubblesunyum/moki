import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { HelperProcess, HelperRpcError, type ChildLike, type SpawnFn } from './helperProcess'

class FakeChild implements ChildLike {
  stdinWrites: string[] = []
  killed = false
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = {
    write: (data: string): boolean => {
      this.stdinWrites.push(data)
      return true
    }
  }

  private readonly handlers = new Map<string, Array<(...args: any[]) => void>>()

  on(event: 'exit' | 'error' | 'close', cb: (...args: any[]) => void): void {
    const list = this.handlers.get(event) ?? []
    list.push(cb)
    this.handlers.set(event, list)
  }

  kill(_signal?: NodeJS.Signals): void {
    this.killed = true
  }

  emitStdout(chunk: string): void {
    this.stdout.emit('data', chunk)
  }

  exit(code = 1): void {
    for (const cb of this.handlers.get('exit') ?? []) cb(code)
  }
}

function quietLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function setup() {
  const children: FakeChild[] = []
  const spawnFn: SpawnFn = () => {
    const child = new FakeChild()
    children.push(child)
    return child
  }
  return { children, spawnFn }
}

function lastRequest(children: FakeChild[]) {
  const raw = children[0]?.stdinWrites.at(-1)
  if (!raw) throw new Error('no request written')
  return JSON.parse(raw) as { jsonrpc: string; id: number; method: string; params?: unknown }
}

describe('HelperProcess request/response matching', () => {
  it('writes a JSON-RPC request and resolves with the result', async () => {
    const { children, spawnFn } = setup()
    const helper = new HelperProcess({
      binaryPath: '/tmp/moki-helper',
      spawnFn,
      logger: quietLogger(),
      initialRestartDelayMs: 10,
      maxRestartDelayMs: 20
    })
    helper.start()
    const pending = helper.call<{ ok: boolean }>('helper.ping')
    const req = lastRequest(children)
    expect(req.method).toBe('helper.ping')
    expect(req.jsonrpc).toBe('2.0')
    children[0]?.emitStdout(
      `${JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } })}\n`
    )
    await expect(pending).resolves.toEqual({ ok: true })
    expect(helper.getStatus()).toBe('ok')
    helper.dispose()
  })

  it('rejects with the helper error shape', async () => {
    const { children, spawnFn } = setup()
    const helper = new HelperProcess({
      binaryPath: '/tmp/moki-helper',
      spawnFn,
      logger: quietLogger()
    })
    helper.start()
    const pending = helper.call('accounts.list')
    const req = lastRequest(children)
    children[0]?.emitStdout(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32000, message: 'expired', data: { code: 'auth_expired' } }
      })}\n`
    )
    const err = await pending.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HelperRpcError)
    expect((err as HelperRpcError).code).toBe(-32000)
    expect((err as HelperRpcError).data).toEqual({ code: 'auth_expired' })
    helper.dispose()
  })

  it('reassembles responses split across stdout chunks', async () => {
    const { children, spawnFn } = setup()
    const helper = new HelperProcess({
      binaryPath: '/tmp/moki-helper',
      spawnFn,
      logger: quietLogger()
    })
    helper.start()
    const pending = helper.call('helper.ping')
    const req = lastRequest(children)
    const full = JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } })
    children[0]?.emitStdout(`${full.slice(0, 12)}`)
    children[0]?.emitStdout(`${full.slice(12)}\n`)
    await expect(pending).resolves.toEqual({ ok: true })
    helper.dispose()
  })

  it('routes notifications without resolving pending calls', async () => {
    const { children, spawnFn } = setup()
    const helper = new HelperProcess({
      binaryPath: '/tmp/moki-helper',
      spawnFn,
      logger: quietLogger()
    })
    helper.start()
    const seen: Array<{ method: string; params: unknown }> = []
    helper.onNotification((method, params) => {
      seen.push({ method, params })
    })
    const pending = helper.call('helper.ping')
    children[0]?.emitStdout(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'helper.status', params: { status: 'ok' } })}\n`
    )
    const req = lastRequest(children)
    children[0]?.emitStdout(
      `${JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } })}\n`
    )
    await expect(pending).resolves.toEqual({ ok: true })
    expect(seen).toContainEqual({ method: 'helper.status', params: { status: 'ok' } })
    helper.dispose()
  })

  it('ignores non-JSON stdout lines', async () => {
    const { children, spawnFn } = setup()
    const logger = quietLogger()
    const helper = new HelperProcess({ binaryPath: '/tmp/moki-helper', spawnFn, logger })
    helper.start()
    const pending = helper.call('helper.ping')
    children[0]?.emitStdout('not json at all\n')
    const req = lastRequest(children)
    children[0]?.emitStdout(
      `${JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } })}\n`
    )
    await expect(pending).resolves.toEqual({ ok: true })
    expect(logger.warn).toHaveBeenCalled()
    helper.dispose()
  })

  it('times out calls without a response', async () => {
    const { spawnFn } = setup()
    const helper = new HelperProcess({
      binaryPath: '/tmp/moki-helper',
      spawnFn,
      logger: quietLogger(),
      timeoutMs: 20
    })
    helper.start()
    await expect(helper.call('helper.ping')).rejects.toThrow(/timed out/)
    helper.dispose()
  })

  it('rejects pending calls on exit and restarts with backoff', async () => {
    const { children, spawnFn } = setup()
    const logger = quietLogger()
    const statuses: string[] = []
    const helper = new HelperProcess({
      binaryPath: '/tmp/moki-helper',
      spawnFn,
      logger,
      initialRestartDelayMs: 10,
      maxRestartDelayMs: 20
    })
    helper.onStatus((s) => {
      statuses.push(s)
    })
    helper.start()
    const pending = helper.call('helper.ping')
    children[0]?.exit()
    await expect(pending).rejects.toThrow(/exited/)
    expect(helper.getStatus()).toBe('down')
    await new Promise((r) => setTimeout(r, 50))
    expect(children.length).toBeGreaterThan(1)
    expect(statuses).toContain('down')
    helper.dispose()
  })

  it('does not synthesize helper.status notifications from status changes', () => {
    const { children, spawnFn } = setup()
    const helper = new HelperProcess({
      binaryPath: '/tmp/moki-helper',
      spawnFn,
      logger: quietLogger(),
      initialRestartDelayMs: 10,
      maxRestartDelayMs: 20
    })
    const seen: Array<{ method: string; params: unknown }> = []
    helper.onNotification((method, params) => {
      seen.push({ method, params })
    })
    const statuses: string[] = []
    helper.onStatus((s) => {
      statuses.push(s)
    })
    helper.start()
    children[0]?.exit()
    expect(statuses).toContain('down')
    expect(seen.filter((n) => n.method === 'helper.status')).toEqual([])
    helper.dispose()
  })

  it('drops a partial line on exit and ignores the dead child afterwards', async () => {
    const { children, spawnFn } = setup()
    const helper = new HelperProcess({
      binaryPath: '/tmp/moki-helper',
      spawnFn,
      logger: quietLogger(),
      initialRestartDelayMs: 10,
      maxRestartDelayMs: 20
    })
    helper.start()
    children[0]?.emitStdout('{"jsonrpc":"2.0","id":1,"result":')
    children[0]?.exit()
    await new Promise((r) => setTimeout(r, 50))
    expect(children.length).toBe(2)
    const pending = helper.call<{ ok: boolean }>('helper.ping')
    const raw = children[1]?.stdinWrites.at(-1)
    if (!raw) throw new Error('no request written after restart')
    const req = JSON.parse(raw) as { id: number }
    children[0]?.emitStdout(
      `{"jsonrpc":"2.0","id":${req.id},"result":{"poisoned":true}}\n`
    )
    children[1]?.emitStdout(
      `${JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } })}\n`
    )
    await expect(pending).resolves.toEqual({ ok: true })
    helper.dispose()
  })

  it('queues calls while down without spawning ahead of the backoff', async () => {
    const { children, spawnFn } = setup()
    const helper = new HelperProcess({
      binaryPath: '/tmp/moki-helper',
      spawnFn,
      logger: quietLogger(),
      initialRestartDelayMs: 20,
      maxRestartDelayMs: 40
    })
    helper.start()
    const doomed = helper.call('helper.ping')
    children[0]?.exit()
    await expect(doomed).rejects.toThrow(/exited/)
    const pending = helper.call<{ ok: boolean }>('helper.ping')
    let settled: string | null = null
    void pending.then(
      () => {
        settled = 'resolved'
      },
      () => {
        settled = 'rejected'
      }
    )
    expect(children.length).toBe(1)
    await new Promise((r) => setTimeout(r, 5))
    expect(settled).toBeNull()
    expect(children.length).toBe(1)
    await new Promise((r) => setTimeout(r, 80))
    expect(children.length).toBe(2)
    const raw = children[1]?.stdinWrites.at(-1)
    if (!raw) throw new Error('queued call was never sent')
    const req = JSON.parse(raw) as { id: number }
    children[1]?.emitStdout(
      `${JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } })}\n`
    )
    await expect(pending).resolves.toEqual({ ok: true })
    helper.dispose()
  })
})
