import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { App, BrowserWindow, Clipboard, IpcMain, Shell } from 'electron'
import type { DayClipboardEntry } from '../../../../../packages/protocol/src/index'
import { ClipboardWatcher } from './clipboard'
import { downloadsDir, isPathAllowed, listDownloads } from './files'
import { fetchUsage } from './usage'
import { getSystemStats } from './system'

const DAY_CALL_CHANNEL = 'day:call'
const NOTIFY_CHANNEL = 'rpc:notify'

function broadcast(getWindows: () => BrowserWindow[], method: string, params: unknown): void {
  for (const win of getWindows()) {
    try {
      win.webContents.send(NOTIFY_CHANNEL, method, params)
    } catch {
    }
  }
}

/**
 * Live Day data over `day:call` (clipboard, ~/Downloads, usage, system).
 * The preload exposes it as `moki.local`; pushes reuse `rpc:notify` so no
 * preload change is needed for notifications.
 */
export function setupDayIpc(
  ipcMain: IpcMain,
  shell: Pick<Shell, 'openPath' | 'showItemInFolder'>,
  getWindows: () => BrowserWindow[],
  deps?: {
    app?: Pick<App, 'getPath'>
    clipboard?: Pick<Clipboard, 'readText'>
  }
): () => void {
  let electronApp: Pick<App, 'getPath'> | null = deps?.app ?? null
  let electronClipboard: Pick<Clipboard, 'readText'> | null = deps?.clipboard ?? null
  if (!electronApp || !electronClipboard) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as {
        app?: Pick<App, 'getPath'>
        clipboard?: Pick<Clipboard, 'readText'>
      }
      electronApp ??= electron.app ?? null
      electronClipboard ??= electron.clipboard ?? null
    } catch {
      /* Under test there is no Electron runtime — injected deps cover it. */
    }
  }

  const storeFile = (() => {
    try {
      if (electronApp) return join(electronApp.getPath('userData'), 'day-clipboard.json')
    } catch {
    }
    return null
  })()

  const load = (): DayClipboardEntry[] => {
    try {
      if (!storeFile || !existsSync(storeFile)) return []
      const raw = JSON.parse(readFileSync(storeFile, 'utf8')) as unknown
      const list = Array.isArray(raw) ? raw : (raw as { entries?: unknown }).entries
      if (!Array.isArray(list)) return []
      return list.filter(
        (e): e is DayClipboardEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as { text?: unknown }).text === 'string' &&
          typeof (e as { id?: unknown }).id === 'string'
      )
    } catch {
      return []
    }
  }

  const watcher = new ClipboardWatcher({
    readText: () => {
      try {
        const text: unknown = electronClipboard?.readText()
        return typeof text === 'string' ? text : ''
      } catch {
        return ''
      }
    },
    load,
    save: (entries) => {
      if (!storeFile) return
      try {
        mkdirSync(join(storeFile, '..'), { recursive: true })
      } catch {
      }
      try {
        writeFileSync(storeFile, JSON.stringify({ entries }), 'utf8')
      } catch {
      }
    },
    onNew: (entry) => broadcast(getWindows, 'day.clipboardChanged', { entry })
  })
  watcher.start()

  ipcMain.handle(DAY_CALL_CHANNEL, async (_event, method: string, params?: unknown) => {
    switch (method) {
      case 'day.clipboardList':
        return { entries: watcher.list() }
      case 'day.clipboardClear':
        watcher.clear()
        return { ok: true }
      case 'day.downloadsList': {
        const showHidden =
          typeof params === 'object' && params !== null
            ? Boolean((params as { showHidden?: unknown }).showHidden)
            : false
        return { entries: await listDownloads(showHidden) }
      }
      case 'day.openPath':
      case 'day.revealPath': {
        const target = (params as { path?: unknown } | null | undefined)?.path
        if (typeof target !== 'string' || target === '') throw new Error('blocked path')
        const dir = downloadsDir()
        if (!isPathAllowed(target, dir)) throw new Error('blocked path')
        if (method === 'day.openPath') {
          await shell.openPath(target)
        } else {
          shell.showItemInFolder(target)
        }
        return { ok: true }
      }
      case 'day.usageGet':
        return fetchUsage()
      case 'day.systemGet':
        return getSystemStats()
      default:
        throw new Error(`unknown day method: ${String(method)}`)
    }
  })

  return () => watcher.stop()
}

export const __test__ = { DAY_CALL_CHANNEL, NOTIFY_CHANNEL }
