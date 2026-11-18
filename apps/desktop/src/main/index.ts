import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { captureWhenSettled } from './dev/capture'
import { HelperProcess, resolveHelperBinary, setupHelperIpc } from './helper/index'

let helper: HelperProcess | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    title: 'Moki',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    backgroundColor: '#0b0b14',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (!app.isPackaged) captureWhenSettled(win, () => app.quit())

  win.once('ready-to-show', () => {
    win.show()
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void win.loadURL(rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  helper = new HelperProcess({ binaryPath: resolveHelperBinary(app.getAppPath()) })
  helper.start()
  setupHelperIpc(ipcMain, shell, helper, () => BrowserWindow.getAllWindows())

  // Dev smoke: prove the stdio round-trip once at startup.
  if (!app.isPackaged) {
    void helper
      .call<{ ok: boolean; version: string }>('helper.ping')
      .then((result) => {
        console.log(`[helper] ping ok (version ${result.version})`)
      })
      .catch((err: unknown) => {
        console.error(`[helper] startup ping failed: ${String(err)}`)
      })
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  helper?.dispose()
  helper = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
