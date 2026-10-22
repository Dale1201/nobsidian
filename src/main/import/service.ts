import type { ImportResult, ImportStatus } from '../../shared/types'
import type { Workspace } from '../workspace/workspace'
import type { WorkerInput, WorkerMessage } from './types'

/** The part of a `worker_threads` Worker the service uses, so tests can run imports in-process. */
export interface ImportWorker {
  on(event: 'message', listener: (message: WorkerMessage) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  terminate(): Promise<number>
}

interface Running {
  workspace: Workspace
  worker: ImportWorker
  staging: string
  landing: boolean
  settled: Promise<void>
}

/** Runs one Notion import at a time and reports its status. */
export class ImportService {
  private current: Running | null = null

  constructor(
    private readonly startWorker: (input: WorkerInput) => ImportWorker,
    private readonly onStatus: (status: ImportStatus) => void
  ) {}

  get running(): boolean {
    return this.current !== null
  }

  /** Running and not yet being added to the workspace, so it can still be cancelled. */
  get cancellable(): boolean {
    return this.current !== null && !this.current.landing
  }

  /** Starts importing `zips` into `workspace`; resolves once it has started. */
  async start(workspace: Workspace, zips: string[]): Promise<void> {
    if (this.current) throw new Error('An import is already running.')
    const staging = await workspace.createImportStaging()
    let worker: ImportWorker
    try {
      worker = this.startWorker({ zips, staging })
    } catch (err) {
      await workspace.discardImport(staging)
      throw err
    }
    this.onStatus({ state: 'running', progress: { phase: 'reading', done: 0, total: 0 } })
    let finish!: () => void
    const run: Running = {
      workspace,
      worker,
      staging,
      landing: false,
      settled: new Promise((resolve) => (finish = resolve))
    }
    this.current = run
    const end = async (status: ImportStatus, discard: boolean): Promise<void> => {
      if (this.current !== run) return
      this.current = null
      if (discard) await workspace.discardImport(staging).catch(() => {})
      this.onStatus(status)
      finish()
    }
    worker.on('message', (message) => {
      if (this.current !== run || run.landing) return
      if (message.type === 'progress') {
        this.onStatus({ state: 'running', progress: message.progress })
      } else if (message.type === 'error') {
        void worker.terminate()
        void end({ state: 'failed', message: message.message }, true)
      } else {
        run.landing = true
        void worker.terminate()
        this.onStatus({ state: 'running', progress: { phase: 'finishing', done: 0, total: 0 } })
        void workspace.landImport(message.manifest, staging).then(
          (result: ImportResult) => end({ state: 'done', ...result }, false),
          (err: unknown) => end({ state: 'failed', message: landingError(err) }, true)
        )
      }
    })
    worker.on('error', (err) => {
      if (!run.landing)
        void end({ state: 'failed', message: `The import failed: ${err.message}` }, true)
    })
    worker.on('exit', () => {
      if (!run.landing)
        void end({ state: 'failed', message: 'The import stopped unexpectedly.' }, true)
    })
  }

  /** Stops a running import and deletes what it staged; too late once it is being added. */
  async cancel(): Promise<boolean> {
    const run = this.current
    if (!run || run.landing) return false
    this.current = null
    await run.worker.terminate()
    await run.workspace.discardImport(run.staging).catch(() => {})
    this.onStatus({ state: 'cancelled' })
    return true
  }

  /** Waits for a running import to finish landing, or cancels it before it lands. */
  async stop(): Promise<void> {
    const run = this.current
    if (!run) return
    if (run.landing) await run.settled
    else await this.cancel()
  }
}

function landingError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC') return 'Not enough disk space.'
  return `The import failed: ${err instanceof Error ? err.message : String(err)}`
}
