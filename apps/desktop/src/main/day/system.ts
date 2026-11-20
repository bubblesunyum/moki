import { execFile } from 'node:child_process'
import { cpus, freemem, totalmem } from 'node:os'
import type { DaySystemProcess, DaySystemResult } from '../../../../../packages/protocol/src/index'

/* No temperature fields: the SMC is unreachable from JS without native
 * addons or parsing `powermetrics` as root — deliberately omitted. */

export interface CpuTimesSample {
  idle: number
  total: number
}

export function sampleCpus(
  list: Array<{ times: { user: number; nice: number; sys: number; idle: number; irq: number } }> = cpus()
): CpuTimesSample {
  let idle = 0
  let total = 0
  for (const cpu of list) {
    idle += cpu.times.idle
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
  }
  return { idle, total }
}

/** Busy/total delta between two samples; null when there is no delta yet. */
export function diffCpuPercent(prev: CpuTimesSample, curr: CpuTimesSample): number | null {
  const totalDelta = curr.total - prev.total
  const idleDelta = curr.idle - prev.idle
  if (totalDelta <= 0) return null
  const busy = totalDelta - idleDelta
  return Math.round(((busy / totalDelta) * 100) * 10) / 10
}

export function memoryPressure(usedPct: number): DaySystemResult['memoryPressure'] {
  if (usedPct > 85) return 'critical'
  if (usedPct > 65) return 'warning'
  return 'normal'
}

/* `pmset -g batt` shapes:
 *   " 82%; discharging; 6:12 remaining present: true" -> {82,false,372}
 *   " 100%; charged; 0:00 remaining ..."              -> {100,false,0}
 *   " 45%; charging; 1:05 remaining ..."              -> {45,true,65}
 *   "AC Power ... (no battery)" / unparsable          -> nulls. */
export function parsePmsetBatt(output: string): {
  percent: number | null
  charging: boolean | null
  minutesLeft: number | null
} {
  const pctMatch = /(\d{1,3})\s*%/.exec(output)
  if (!pctMatch) return { percent: null, charging: null, minutesLeft: null }
  const percent = Math.min(100, Math.max(0, Number(pctMatch[1])))
  const lower = output.toLowerCase()
  let charging: boolean | null = null
  if (lower.includes('discharging')) charging = false
  else if (lower.includes('charging') || lower.includes('finishing charge')) charging = true
  else if (lower.includes('charged')) charging = false
  let minutesLeft: number | null = null
  const remainMatch = /(\d+):(\d+)\s+remaining/.exec(output)
  if (remainMatch) {
    minutesLeft = Number(remainMatch[1]) * 60 + Number(remainMatch[2])
  }
  return { percent, charging, minutesLeft }
}

/* `ps -Aceo pid,pcpu,comm -r` rows: header + `pid %cpu command`. Re-sorts
 * desc by cpu (ps -r already sorts, but stay defensive), top `limit`. */
export function parsePsOutput(output: string, limit = 12): DaySystemProcess[] {
  const lines = output.split('\n').slice(1)
  const procs: DaySystemProcess[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 3) continue
    const pid = Number(parts[0])
    const cpu = Number(parts[1])
    if (!Number.isFinite(pid) || !Number.isFinite(cpu)) continue
    const name = parts.slice(2).join(' ')
    if (name === '') continue
    procs.push({ pid, cpu, name })
  }
  procs.sort((a, b) => b.cpu - a.cpu)
  return procs.slice(0, limit)
}

export interface SystemSamplerDeps {
  sampleCpus?: () => CpuTimesSample
  readMemory?: () => { used: number; total: number }
  readBattery?: () => Promise<{ percent: number | null; charging: boolean | null; minutesLeft: number | null }>
  readBreakdown?: () => Promise<DaySystemProcess[]>
  now?: () => number
}

let lastCpuSample: CpuTimesSample | null = null
let lastBreakdown: DaySystemProcess[] = []
let lastBreakdownAt = 0
const BREAKDOWN_THROTTLE_MS = 4000

export function resetSystemSampler(): void {
  lastCpuSample = null
  lastBreakdown = []
  lastBreakdownAt = 0
}

function runExec(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout }, (err, stdout) => {
      if (err) {
        resolve('')
        return
      }
      resolve(String(stdout ?? ''))
    })
  })
}

export async function getSystemStats(deps: SystemSamplerDeps = {}): Promise<DaySystemResult> {
  const now = deps.now ?? Date.now
  const sample = (deps.sampleCpus ?? sampleCpus)()
  let cpuPercent: number | null = null
  if (lastCpuSample) cpuPercent = diffCpuPercent(lastCpuSample, sample)
  lastCpuSample = sample

  const mem = (deps.readMemory ?? (() => ({ used: totalmem() - freemem(), total: totalmem() })))()
  const usedPct = mem.total > 0 ? (mem.used / mem.total) * 100 : 0

  const battery = await (async () => {
    if (deps.readBattery) return deps.readBattery()
    const out = await runExec('pmset', ['-g', 'batt'], 5000)
    if (out.trim() === '') return { percent: null, charging: null, minutesLeft: null }
    return parsePmsetBatt(out)
  })()

  const at = now()
  if (deps.readBreakdown) {
    if (at - lastBreakdownAt >= BREAKDOWN_THROTTLE_MS || lastBreakdown.length === 0) {
      lastBreakdown = await deps.readBreakdown()
      lastBreakdownAt = at
    }
  } else if (at - lastBreakdownAt >= BREAKDOWN_THROTTLE_MS || lastBreakdown.length === 0) {
    const out = await runExec('ps', ['-Aceo', 'pid,pcpu,comm', '-r'], 5000)
    lastBreakdown = out.trim() === '' ? [] : parsePsOutput(out)
    lastBreakdownAt = at
  }

  return {
    cpuPercent,
    cpuCores: cpus().length,
    memoryUsedBytes: mem.used,
    memoryTotalBytes: mem.total,
    memoryPressure: memoryPressure(usedPct),
    batteryPercent: battery.percent,
    batteryCharging: battery.charging,
    batteryMinutesLeft: battery.minutesLeft,
    breakdown: lastBreakdown,
    sampledAt: at
  }
}
