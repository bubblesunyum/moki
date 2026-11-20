import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const callDayMock = vi.fn()
const onBridgeMock = vi.fn()

vi.mock('../../../rpc/bridge', () => ({
  callDay: (...args: unknown[]) => callDayMock(...args),
  onBridge: (...args: unknown[]) => onBridgeMock(...args),
  getBridge: () => null
}))

import { ClipboardWidget, CLIPBOARD_STORAGE_KEY } from './ClipboardWidget'
import { FilesWidget, FILES_STORAGE_KEY } from './FilesWidget'
import { UsageWidget } from './UsageWidget'
import { SystemToolsWidget } from './SystemToolsWidget'

afterEach(() => cleanup())
beforeEach(() => {
  window.localStorage.clear()
  callDayMock.mockReset()
  onBridgeMock.mockReset()
  onBridgeMock.mockReturnValue(() => {})
  callDayMock.mockImplementation((method: string) => {
    if (method === 'day.clipboardList') return Promise.resolve({ entries: [] })
    if (method === 'day.downloadsList') return Promise.resolve({ entries: [] })
    if (method === 'day.usageGet') return Promise.resolve({ status: 'unavailable' })
    if (method === 'day.systemGet') return Promise.resolve(null)
    return Promise.resolve({})
  })
})

describe('ClipboardWidget live merge', () => {
  it('renders live entries above local ones and dedupes by text', async () => {
    window.localStorage.setItem(
      CLIPBOARD_STORAGE_KEY,
      JSON.stringify({ entries: [{ id: 'local-1', text: 'local only', isPinned: false, copiedAt: 1 }] })
    )
    callDayMock.mockImplementation((method: string) => {
      if (method === 'day.clipboardList') {
        return Promise.resolve({ entries: [{ id: 'l1', text: 'live hello', copiedAt: 2 }] })
      }
      return Promise.resolve({})
    })
    render(<ClipboardWidget />)
    await waitFor(() => expect(screen.getByText('live hello')).toBeDefined())
    expect(screen.getByText('local only')).toBeDefined()
    // Live rows copy like any other row.
    expect(screen.getByRole('button', { name: 'Copy live hello' })).toBeDefined()
  })

  it('hides live rows whose text is pinned locally', async () => {
    window.localStorage.setItem(
      CLIPBOARD_STORAGE_KEY,
      JSON.stringify({ entries: [{ id: 'p1', text: 'keep me', isPinned: true, copiedAt: 1 }] })
    )
    callDayMock.mockImplementation((method: string) => {
      if (method === 'day.clipboardList') {
        return Promise.resolve({ entries: [{ id: 'l1', text: 'keep me', copiedAt: 2 }] })
      }
      return Promise.resolve({})
    })
    render(<ClipboardWidget />)
    await waitFor(() => expect(screen.getByText('keep me')).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Copy keep me' })).not.toBeNull()
    // Only one row for the deduped text (the local pin).
    expect(screen.getAllByText('keep me')).toHaveLength(1)
  })
})

describe('FilesWidget downloads', () => {
  it('renders the DOWNLOADS section with open + reveal', async () => {
    window.localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify({ entries: [] }))
    callDayMock.mockImplementation((method: string) => {
      if (method === 'day.downloadsList') {
        return Promise.resolve({
          entries: [{ name: 'report.pdf', fullPath: '/Users/t/Downloads/report.pdf', mtimeMs: 5, isDir: false }]
        })
      }
      return Promise.resolve({ ok: true })
    })
    render(<FilesWidget />)
    await waitFor(() => expect(screen.getByRole('region', { name: 'Downloads' })).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Open report.pdf' }))
    await waitFor(() =>
      expect(callDayMock).toHaveBeenCalledWith('day.openPath', { path: '/Users/t/Downloads/report.pdf' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show report.pdf in Finder' }))
    await waitFor(() =>
      expect(callDayMock).toHaveBeenCalledWith('day.revealPath', { path: '/Users/t/Downloads/report.pdf' })
    )
  })
})

describe('UsageWidget live', () => {
  it('replaces samples with live rows and drops the sample line', async () => {
    callDayMock.mockImplementation((method: string) => {
      if (method === 'day.usageGet') {
        return Promise.resolve({
          status: 'live',
          rolling: { percent: 62, resetsAt: null },
          weekly: { percent: 38, resetsAt: null },
          monthly: { percent: 11, resetsAt: null }
        })
      }
      return Promise.resolve({})
    })
    render(<UsageWidget />)
    await waitFor(() => expect(screen.getByLabelText('5 hours usage 62%')).toBeDefined())
    expect(screen.queryByText('Sample data — connect Go with /connect')).toBeNull()
  })
})

describe('SystemToolsWidget live', () => {
  it('renders live cpu/mem/battery with -- for unknown and keeps tools', async () => {
    callDayMock.mockImplementation((method: string) => {
      if (method === 'day.systemGet') {
        return Promise.resolve({
          cpuPercent: null,
          cpuCores: 8,
          memoryUsedBytes: 9.3 * 1024 ** 3,
          memoryTotalBytes: 16 * 1024 ** 3,
          memoryPressure: 'normal',
          batteryPercent: 82,
          batteryCharging: false,
          batteryMinutesLeft: 372,
          breakdown: [{ pid: 1, cpu: 9, name: 'Moki' }],
          sampledAt: 0
        })
      }
      return Promise.resolve({})
    })
    render(<SystemToolsWidget />)
    await waitFor(() => expect(screen.queryByText('Sample data — live stats coming')).toBeNull())
    // Unknown CPU renders "--", known memory/battery render values.
    expect(screen.getAllByText('--').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Memory'))
    expect(screen.getByText(/9\.3 \/ 16\.0 GB/)).toBeDefined()
    for (const tool of ['Copy Text', 'Focus 25-min', 'Mute', 'Screenshot']) {
      expect(screen.getByRole('button', { name: tool })).toBeDefined()
    }
  })
})
