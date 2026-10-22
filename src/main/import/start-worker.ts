import createImportWorker from './worker?nodeWorker'
import type { ImportWorker } from './service'
import type { WorkerInput } from './types'

export function startImportWorker(input: WorkerInput): ImportWorker {
  return createImportWorker({ workerData: input })
}
