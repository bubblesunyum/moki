import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { captureSelectionFromEnv, captureSelectionQuery, captureWhenSettled, withCaptureSelection } from './dev/capture'
import { HelperProcess, resolveHelperBinary, setupHelperIpc } from './helper/index'
import { setupDayIpc } from './day/index'
import { setupWebviewPopups } from './webPopups'
import { installWebSession } from './web-session'
import { setupZenCookieImport } from './zenCookies'

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
      sandbox: true,
      webviewTag: true
    }
  })

  if (!app.isPackaged) captureWhenSettled(win, () => app.quit())

  win.once('ready-to-show', () => {
    win.show()
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  const selection = captureSelectionFromEnv()
  if (rendererUrl) {
    void win.loadURL(withCaptureSelection(rendererUrl, selection))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: captureSelectionQuery(selection)
    })
  }
}

/* Single-instance gate: two Electron copies sharing persist:moki-websites
 * corrupt Notion IndexedDB with concurrent writes. The second copy quits
 * here — before any window exists and before the session is ever touched —
 * and hands off to the first via second-instance (focus, never a new
 * window). Everything below runs only in the lock holder, so a window is
 * never created with zero guards. */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const first = BrowserWindow.getAllWindows()[0]
    if (first && !first.isDestroyed()) {
      if (first.isMinimized()) first.restore()
      first.focus()
    }
  })

  void app.whenReady().then(() => {
    helper = new HelperProcess({
      binaryPath: resolveHelperBinary(app.getAppPath(), {
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath
      })
    })
    helper.start()
    setupHelperIpc(ipcMain, shell, helper, () => BrowserWindow.getAllWindows())
    setupDayIpc(ipcMain, shell, () => BrowserWindow.getAllWindows())
    setupWebviewPopups()
    // One shared websites session for Day tile, Peek, Docs preview, future tabs.
    // Installed unconditionally: only the lock holder reaches here.
    installWebSession({
      notify: (notice) => {
        console.log(`[web-session] download blocked: ${notice.url}`)
      }
    })
    setupZenCookieImport(ipcMain)

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
}

app.on('before-quit', () => {
  helper?.dispose()
  helper = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
