import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const callDayMock = vi.fn()
const onBridgeMock = vi.fn()

vi.mock('../../../rpc/bridge', () => ({
  callDay: (...args: unknown[]) => callDayMock(...args),
  onBridge: (...args: unknown[]) => onBridgeMock(...args),
  getBridge: () => null
}))

import { useDayClipboard } from './useDayClipboard'
import { useDownloads } from './useDownloads'
import { formatResetText, useUsage } from './useUsage'
import { formatBatteryDetail, formatBytesGb, useSystemStats } from './useSystemStats'

beforeEach(() => {
  callDayMock.mockReset()
  onBridgeMock.mockReset()
  onBridgeMock.mockReturnValue(() => {})
})

describe('useDayClipboard', () => {
  it('loads the initial list and prepends pushes without dupes', async () => {
    callDayMock.mockResolvedValue({ entries: [{ id: 'a', text: 'first', copiedAt: 1 }] })
    let push: ((p: unknown) => void) | null = null
    onBridgeMock.mockImplementation((_event: unknown, cb: (p: unknown) => void) => {
      push = cb
      return () => {}
    })
    const { result } = renderHook(() => useDayClipboard())
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    expect(callDayMock).toHaveBeenCalledWith('day.clipboardList')
    act(() => {
      push?.({ entry: { id: 'b', text: 'second', copiedAt: 2 } })
    })
    expect(result.current.entries.map((e) => e.text)).toEqual(['second', 'first'])
    // Duplicate text is ignored.
    act(() => {
      push?.({ entry: { id: 'c', text: 'first', copiedAt: 3 } })
    })
    expect(result.current.entries).toHaveLength(2)
  })

  it('falls back to [] without a bridge', async () => {
    callDayMock.mockRejectedValue(new Error('no bridge'))
    const { result } = renderHook(() => useDayClipboard())
    await waitFor(() => expect(callDayMock).toHaveBeenCalled())
    expect(result.current.entries).toEqual([])
  })
})

describe('useDownloads', () => {
  it('lists and refetches when showHidden flips', async () => {
    callDayMock.mockResolvedValue({ entries: [] })
    const { rerender } = renderHook(({ hidden }: { hidden: boolean }) => useDownloads(hidden), {
      initialProps: { hidden: false }
    })
    await waitFor(() => expect(callDayMock).toHaveBeenCalledWith('day.downloadsList', { showHidden: false }))
    rerender({ hidden: true })
    await waitFor(() => expect(callDayMock).toHaveBeenCalledWith('day.downloadsList', { showHidden: true }))
  })
})

describe('useUsage + formatResetText', () => {
  it('returns the live snapshot', async () => {
    callDayMock.mockResolvedValue({ status: 'live', rolling: { percent: 62, resetsAt: null } })
    const { result } = renderHook(() => useUsage())
    await waitFor(() => expect(result.current.snapshot?.status).toBe('live'))
  })

  it('formats countdowns', () => {
    expect(formatResetText(null)).toBe('--')
    expect(formatResetText('bogus')).toBe('--')
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(formatResetText('2026-01-01T00:20:00Z', now)).toBe('20m')
    expect(formatResetText('2026-01-01T03:12:00Z', now)).toBe('3h 12m')
    expect(formatResetText('2026-01-03T04:00:00Z', now)).toBe('2d 4h')
  })
})

describe('useSystemStats + formatters', () => {
  it('returns sampler stats', async () => {
    callDayMock.mockResolvedValue({
      cpuPercent: 12,
      cpuCores: 8,
      memoryUsedBytes: 8,
      memoryTotalBytes: 16,
      memoryPressure: 'normal',
      batteryPercent: null,
      batteryCharging: null,
      batteryMinutesLeft: null,
      breakdown: [],
      sampledAt: 0
    })
    const { result } = renderHook(() => useSystemStats())
    await waitFor(() => expect(result.current.stats?.cpuPercent).toBe(12))
  })

  it('formats bytes and battery honestly', () => {
    expect(formatBytesGb(9.3 * 1024 ** 3, 16 * 1024 ** 3)).toBe('9.3 / 16.0 GB')
    expect(formatBytesGb(1, 0)).toBe('--')
    expect(formatBatteryDetail(null, null, null)).toBe('No battery')
    expect(formatBatteryDetail(82, false, 372)).toContain('82%')
    expect(formatBatteryDetail(82, false, 372)).toContain('~6h 12m left')
  })
})
