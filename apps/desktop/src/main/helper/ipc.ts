import type { BrowserWindow, IpcMain, Shell } from 'electron'
import { isExternalHttpUrl } from '../../../../../packages/protocol/src/index'
import type { HelperProcess } from './helperProcess'

const RPC_CHANNEL = 'rpc'
const NOTIFY_CHANNEL = 'rpc:notify'
const OPEN_EXTERNAL_CHANNEL = 'shell:openExternal'

function broadcast(
  getWindows: () => BrowserWindow[],
  method: string,
  params: unknown
): void {
  for (const win of getWindows()) {
    try {
      win.webContents.send(NOTIFY_CHANNEL, method, params)
    } catch {
    }
  }
}

/**
 * Wire the helper to the renderer: `rpc` forwards calls, helper
 * notifications fan out over `rpc:notify`, `helper.status` is translated
 * from the process status, and `shell:openExternal` opens http(s) URLs
 * after validating the scheme.
 */
export function setupHelperIpc(
  ipcMain: IpcMain,
  shell: Pick<Shell, 'openExternal'>,
  helper: HelperProcess,
  getWindows: () => BrowserWindow[]
): void {
  ipcMain.handle(RPC_CHANNEL, (_event, method: string, params?: unknown) => {
    return helper.call(method, params)
  })

  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (_event, url: unknown) => {
    if (!isExternalHttpUrl(url)) {
      throw new Error('blocked non-http(s) URL')
    }
    return shell.openExternal(url)
  })

  helper.onNotification((method, params) => {
    broadcast(getWindows, method, params)
  })

  helper.onStatus((status) => {
    broadcast(getWindows, 'helper.status', { status })
  })
}

export const __test__ = { RPC_CHANNEL, NOTIFY_CHANNEL, OPEN_EXTERNAL_CHANNEL }
