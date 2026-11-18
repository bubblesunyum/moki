import { contextBridge } from 'electron'

// Sandbox-compatible preload: no Node APIs here, only contextBridge.
contextBridge.exposeInMainWorld('moki', {
  ping: () => 'pong'
})
