import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc'
import { send } from './ipc'

export const IMPORT_MENU_ID = 'import-notion'

export function buildMenu(getWindow: () => BrowserWindow | null): Menu {
  const command = (cmd: MenuCommand) => (): void => {
    const win = getWindow()
    if (win) send(win.webContents, 'menu:command', cmd)
  }
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Page', accelerator: 'CmdOrCtrl+N', click: command('new-page') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: command('open-folder') },
        { type: 'separator' },
        {
          id: IMPORT_MENU_ID,
          label: 'Import from Notion…',
          enabled: false,
          click: command('import-notion')
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: command('toggle-sidebar') },
        {
          label: 'Toggle Dark Mode',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: command('toggle-theme')
        },
        { type: 'separator' },
        ...(app.isPackaged
          ? []
          : ([{ role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Search…', accelerator: 'CmdOrCtrl+P', click: command('search') },
        { type: 'separator' },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: command('back') },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: command('forward') }
      ]
    },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}
