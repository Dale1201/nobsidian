import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { Api, IpcEvents } from '../shared/ipc'

// Synthetic files in end-to-end tests have no path on disk, so their name stands in for one.
const e2e = process.env.NOBSIDIAN_E2E === '1'

const api: Api = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (event, listener) => {
    const wrapped = (_e: IpcRendererEvent, data: IpcEvents[typeof event]): void => listener(data)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
  pathForFile: (file) => webUtils.getPathForFile(file) || (e2e ? file.name : '')
}

contextBridge.exposeInMainWorld('api', api)
