import { parentPort, workerData } from 'node:worker_threads'
import { runImport } from './pipeline'
import { ImportError, type WorkerInput, type WorkerMessage } from './types'

const post = (message: WorkerMessage): void => parentPort!.postMessage(message)
const input = workerData as WorkerInput

runImport({ ...input, onProgress: (progress) => post({ type: 'progress', progress }) })
  .then((manifest) => post({ type: 'done', manifest }))
  .catch((err: unknown) => {
    const message =
      err instanceof ImportError
        ? err.message
        : (err as NodeJS.ErrnoException)?.code === 'ENOSPC'
          ? 'Not enough disk space.'
          : `The import failed: ${err instanceof Error ? err.message : String(err)}`
    post({ type: 'error', message })
  })
