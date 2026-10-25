import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc'
import { send } from './ipc'

export const IMPORT_MENU_ID = 'import-notion'

export function buildMenu(getWindow: () => BrowserWindow | null): Menu {
  const command = (cmd: MenuCommand) => (): void => {
    const win = getWindow()
    if (win) send(win.webContents, 'menu:command', cmd)
  }
  // More keys for the same command, as Notion has; hidden items still answer their accelerator.
  const hidden = (cmd: MenuCommand, accelerators: string[]): MenuItemConstructorOptions[] =>
    accelerators.map((accelerator) => ({
      label: accelerator,
      accelerator,
      visible: false,
      click: command(cmd)
    }))
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: command('new-tab') },
        { label: 'New Page', accelerator: 'CmdOrCtrl+N', click: command('new-page') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: command('open-folder') },
        { type: 'separator' },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: command('reopen-tab')
        },
        { type: 'separator' },
        {
          id: IMPORT_MENU_ID,
          label: 'Import from Notion…',
          enabled: false,
          click: command('import-notion')
        },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: command('close-tab') },
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' }
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
    {
      role: 'windowMenu',
      submenu: [
        {
          label: 'Show Previous Tab',
          accelerator: 'Ctrl+Shift+Tab',
          click: command('previous-tab')
        },
        { label: 'Show Next Tab', accelerator: 'Ctrl+Tab', click: command('next-tab') },
        ...hidden('previous-tab', ['Alt+CmdOrCtrl+Left', 'CmdOrCtrl+Shift+[']),
        ...hidden('next-tab', ['Alt+CmdOrCtrl+Right', 'CmdOrCtrl+Shift+]']),
        ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n): MenuItemConstructorOptions => ({
          label: n === 9 ? 'Select Last Tab' : `Select Tab ${n}`,
          accelerator: `CmdOrCtrl+${n}`,
          visible: false,
          click: command(`select-tab-${n}`)
        })),
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}
