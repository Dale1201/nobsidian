import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api, IpcEvents } from '../shared/ipc'

const api: Api = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (event, listener) => {
    const wrapped = (_e: IpcRendererEvent, data: IpcEvents[typeof event]): void => listener(data)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  }
}

contextBridge.exposeInMainWorld('api', api)
