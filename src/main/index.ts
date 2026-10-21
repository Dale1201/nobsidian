import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  screen,
  shell,
  type Rectangle
} from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { ASSET_SCHEME } from '../shared/ipc'
import { openWorkspace, registerHandlers, type AppContext } from './handlers'
import { send } from './ipc'
import { buildMenu } from './menu'
import { SettingsStore } from './settings'

if (process.env.NOBSIDIAN_USER_DATA) app.setPath('userData', process.env.NOBSIDIAN_USER_DATA)

// Test runs stay off screen and never take focus; NOBSIDIAN_E2E_SHOW=1 shows them for debugging.
const hidden = process.env.NOBSIDIAN_E2E === '1' && process.env.NOBSIDIAN_E2E_SHOW !== '1'
if (hidden && process.platform === 'darwin') app.setActivationPolicy('accessory')

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

let mainWindow: BrowserWindow | null = null
let quitting = false
app.on('before-quit', () => {
  quitting = true
})
const ctx: AppContext = {
  settings: new SettingsStore(join(app.getPath('userData'), 'settings.json')),
  workspace: null,
  watcher: null,
  maintainTimer: null,
  window: () => mainWindow
}

/** Saved bounds, unless the display they were on is gone. */
function restoredBounds(): Partial<Rectangle> {
  const saved = ctx.settings.get().windowBounds
  if (!saved) return { width: 1280, height: 820 }
  const area = screen.getDisplayMatching(saved).workArea
  const visible =
    saved.x < area.x + area.width &&
    saved.x + saved.width > area.x &&
    saved.y < area.y + area.height &&
    saved.y + saved.height > area.y
  return visible ? saved : { width: saved.width, height: saved.height }
}

function createWindow(): void {
  const win = new BrowserWindow({
    ...restoredBounds(),
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Nobsidian',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !hidden
    }
  })
  mainWindow = win

  if (!hidden) win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!(
      is.dev &&
      process.env.ELECTRON_RENDERER_URL &&
      url.startsWith(process.env.ELECTRON_RENDERER_URL)
    )) {
      event.preventDefault()
    }
  })

  // Give the renderer a moment to write pending edits before the window goes away.
  // Cancelling the close also cancels an app quit, so the quit is re-issued afterwards.
  let flushed = false
  let closing = false
  win.on('close', (event) => {
    if (flushed) return
    event.preventDefault()
    if (closing) return
    closing = true
    const saving = ctx.settings.set({ windowBounds: win.getNormalBounds() }).catch(() => {})
    let answered = false
    const finish = async (saved: boolean): Promise<void> => {
      if (answered) return
      answered = true
      clearTimeout(timeout)
      if (!saved && !(await closeAnyway(win, quitting))) {
        closing = false
        quitting = false
        return
      }
      flushed = true
      await saving
      await ctx.workspace?.checkpoint().catch(() => {})
      if (quitting) app.quit()
      else win.close()
    }
    ipcMain.removeHandler('app:flushed')
    ipcMain.handle('app:flushed', (_event, { saved }: { saved: boolean }) => finish(saved))
    send(win.webContents, 'app:flush', undefined)
    const timeout = setTimeout(() => void finish(true), 2000)
  })
  win.on('closed', () => {
    mainWindow = null
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Asks before closing over edits the renderer could not save; they are still on screen. */
async function closeAnyway(win: BrowserWindow, quitting: boolean): Promise<boolean> {
  const verb = quitting ? 'Quit' : 'Close'
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    message: "Some edits couldn't be saved.",
    detail: `They're still on screen. If you ${verb.toLowerCase()} now, they'll be lost.`,
    buttons: ['Cancel', `${verb} Anyway`],
    defaultId: 0,
    cancelId: 0
  })
  return response === 1
}

app.whenReady().then(async () => {
  const settings = await ctx.settings.load()
  if (settings.lastWorkspace) {
    try {
      await openWorkspace(ctx, settings.lastWorkspace)
    } catch {
      ctx.workspace = null
    }
  }

  protocol.handle(ASSET_SCHEME, (request) => {
    const url = new URL(request.url)
    const file = ctx.workspace?.resolveAsset(url.pathname)
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  registerHandlers(ctx)
  Menu.setApplicationMenu(buildMenu(() => mainWindow))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
