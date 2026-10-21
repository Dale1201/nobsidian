import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { IpcChannel, IpcEvents, IpcPayload, IpcResult } from '../shared/ipc'

export function handle<C extends IpcChannel>(
  channel: C,
  handler: (
    payload: IpcPayload<C>,
    event: IpcMainInvokeEvent
  ) => Promise<IpcResult<C>> | IpcResult<C>
): void {
  ipcMain.handle(channel, (event, payload: IpcPayload<C>) => handler(payload, event))
}

export function send<E extends keyof IpcEvents>(
  target: WebContents,
  event: E,
  data: IpcEvents[E]
): void {
  if (!target.isDestroyed()) target.send(event, data)
}
