import { parentPort, workerData } from 'node:worker_threads'
import { runImport } from './pipeline'
import { ImportError, type WorkerCommand, type WorkerInput, type WorkerMessage } from './types'

const post = (message: WorkerMessage): void => parentPort!.postMessage(message)
const input = workerData as WorkerInput
const controller = new AbortController()

const running = runImport({
  ...input,
  signal: controller.signal,
  onProgress: (progress) => post({ type: 'progress', progress })
})
  .then((manifest) => post({ type: 'done', manifest }))
  .catch((err: unknown) => {
    if (controller.signal.aborted) return
    const message =
      err instanceof ImportError
        ? err.message
        : (err as NodeJS.ErrnoException)?.code === 'ENOSPC'
          ? 'Not enough disk space.'
          : `The import failed: ${err instanceof Error ? err.message : String(err)}`
    post({ type: 'error', message })
  })

parentPort!.on('message', (command: WorkerCommand) => {
  if (command.type !== 'stop') return
  controller.abort()
  // With the port closed and the zips closed, nothing keeps the thread alive.
  void running.finally(() => parentPort!.close())
})
