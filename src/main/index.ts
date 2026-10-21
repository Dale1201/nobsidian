import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

if (process.env.NOBSIDIAN_USER_DATA) app.setPath('userData', process.env.NOBSIDIAN_USER_DATA)

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Nobsidian',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (is.dev && process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
})
