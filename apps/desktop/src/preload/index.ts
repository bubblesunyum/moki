import { contextBridge, ipcRenderer } from 'electron'
import {
  isExternalHttpUrl,
  type MokiApi
} from '../../../../packages/protocol/src/index'

// Sandbox-compatible preload: no Node APIs here, only contextBridge +
// ipcRenderer. Types and the URL check come from packages/protocol; the
// check is a pure function that bundles in, so nothing Node reaches the sandbox.
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
    if (!isExternalHttpUrl(url)) {
      return Promise.reject(new Error('blocked non-http(s) URL'))
    }
    return ipcRenderer.invoke('shell:openExternal', url) as Promise<void>
  },

  local: (method, params) => ipcRenderer.invoke('day:call', method, params) as never
}

contextBridge.exposeInMainWorld('moki', api)
