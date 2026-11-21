import { contextBridge, ipcRenderer } from 'electron'
import {
  isOpenExternalAllowedUrl,
  type MokiApi
} from '../../../../packages/protocol/src/index'
import {
  ZEN_COOKIES_CHANNEL,
  type ZenCookieImportStatus
} from '../main/zenCookies.shared'

// Sandbox-compatible preload: no Node APIs here, only contextBridge +
// ipcRenderer. Types and the URL checks come from packages/protocol; the
// checks are pure functions that bundle in, so nothing Node reaches the sandbox.
const api: MokiApi = {
  call: (method, params) => ipcRenderer.invoke('rpc', method, params) as never,

  on: (event, cb) => {
    const listener = (_e: unknown, method: unknown, params: unknown): void => {
      if (method === event) {
        ;(cb as (p: never) => void)(params as never)
      }
    }
    ipcRenderer.on('rpc:notify', listener as never)
    return () => {
      ipcRenderer.removeListener('rpc:notify', listener as never)
    }
  },

  openExternal: (url) => {
    if (!isOpenExternalAllowedUrl(url)) {
      return Promise.reject(new Error('blocked URL'))
    }
    return ipcRenderer.invoke('shell:openExternal', url) as Promise<void>
  },

  local: (method, params) => ipcRenderer.invoke('day:call', method, params) as never
}

contextBridge.exposeInMainWorld('moki', api)

/* Additive Zen cookie-import status surface (mok-8uu.5). Separate global so
 * the MokiApi/protocol contract is untouched. Main returns status only —
 * per-host-group ok/failed plus counts; cookie names, hosts and values
 * never cross into the renderer. */
contextBridge.exposeInMainWorld('mokiZenCookies', {
  importCookies: (): Promise<ZenCookieImportStatus> =>
    ipcRenderer.invoke(ZEN_COOKIES_CHANNEL) as Promise<ZenCookieImportStatus>
})

declare global {
  interface Window {
    mokiZenCookies?: {
      importCookies: () => Promise<ZenCookieImportStatus>
    }
  }
}
