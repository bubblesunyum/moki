import { describe, expect, it } from 'vitest'
import {
  diffCpuPercent,
  getSystemStats,
  memoryPressure,
  parsePmsetBatt,
  parsePsOutput,
  resetSystemSampler,
  sampleCpus
} from './system'

describe('parsePmsetBatt', () => {
  it('parses discharging with hours left', () => {
    expect(parsePmsetBatt(" -InternalBattery-0 (id=1)  82%; discharging; 6:12 remaining present: true")).toEqual({
      percent: 82,
      charging: false,
      minutesLeft: 372
    })
  })

  it('parses charging and charged', () => {
    expect(parsePmsetBatt(' 45%; charging; 1:05 remaining').charging).toBe(true)
    expect(parsePmsetBatt(' 45%; charging; 1:05 remaining').minutesLeft).toBe(65)
    expect(parsePmsetBatt(' 100%; charged; 0:00 remaining').charging).toBe(false)
  })

  it('returns nulls without a battery', () => {
    expect(parsePmsetBatt('Now drawing from AC Power (no battery)')).toEqual({
      percent: null,
      charging: null,
      minutesLeft: null
    })
  })
})

describe('diffCpuPercent', () => {
  it('computes the busy delta and nulls on no delta', () => {
    expect(diffCpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50)
    expect(diffCpuPercent({ idle: 1, total: 2 }, { idle: 1, total: 2 })).toBeNull()
  })
})

describe('sampleCpus / memoryPressure', () => {
  it('samples idle/total sums', () => {
    const sample = sampleCpus([
      { times: { user: 1, nice: 0, sys: 1, idle: 8, irq: 0 } },
      { times: { user: 1, nice: 0, sys: 1, idle: 8, irq: 0 } }
    ])
    expect(sample).toEqual({ idle: 16, total: 20 })
  })

  it('grades pressure at 65/85 boundaries', () => {
    expect(memoryPressure(10)).toBe('normal')
    expect(memoryPressure(66)).toBe('warning')
    expect(memoryPressure(86)).toBe('critical')
  })
})

describe('parsePsOutput', () => {
  it('skips the header, re-sorts desc, and caps at twelve', () => {
    const lines = ['PID %CPU COMMAND', '1 0.5 a', '2 9.0 b', 'x bad line', '3 4.0 some thing here']
    const parsed = parsePsOutput(lines.join('\n'))
    expect(parsed.map((p) => p.pid)).toEqual([2, 3, 1])
    expect(parsed[2]).toMatchObject({ cpu: 0.5, name: 'a' })
    expect(parsed[1]).toMatchObject({ name: 'some thing here' })
    const many = ['PID %CPU COMMAND', ...Array.from({ length: 20 }, (_, i) => `${i + 10} ${i}.0 p${i}`)].join('\n')
    expect(parsePsOutput(many)).toHaveLength(12)
  })
})

describe('getSystemStats', () => {
  it('nulls cpu on the first sample, then diffs', async () => {
    resetSystemSampler()
    let sample = { idle: 100, total: 200 }
    const deps = {
      sampleCpus: () => sample,
      readMemory: () => ({ used: 8, total: 16 }),
      readBattery: async () => ({ percent: 50 as number | null, charging: false as boolean | null, minutesLeft: 60 as number | null }),
      readBreakdown: async () => [{ pid: 1, cpu: 5, name: 'a' }],
      now: () => 0
    }
    const first = await getSystemStats(deps)
    expect(first.cpuPercent).toBeNull()
    expect(first.memoryPressure).toBe('normal')
    sample = { idle: 150, total: 300 }
    const second = await getSystemStats({ ...deps, now: () => 5000 })
    expect(second.cpuPercent).toBe(50)
    resetSystemSampler()
  })
})
