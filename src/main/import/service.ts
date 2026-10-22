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

/** One import, from the moment it takes the slot until it has ended. */
interface Run {
  workspace: Workspace
  /** A cancel can arrive before the folder exists, so the folder is a promise. */
  staging: Promise<string>
  worker: ImportWorker | null
  landing: boolean
  /** Resolves once the import has landed or ended, before its cleanup finishes. */
  settled: Promise<void>
  settle: () => void
}

/** Runs one Notion import at a time and reports its status. */
export class ImportService {
  private current: Run | null = null
  /** Stopping a worker and deleting its folder; a new import and stop() wait for it. */
  private cleanup: Promise<void> | null = null

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
    while (this.cleanup) await this.cleanup
    if (this.current) throw new Error('An import is already running.')
    // Taking the slot before the first await makes an overlapping start fail.
    let settle!: () => void
    const settled = new Promise<void>((resolve) => (settle = resolve))
    const run: Run = {
      workspace,
      staging: workspace.createImportStaging(),
      worker: null,
      landing: false,
      settled,
      settle
    }
    this.current = run
    let staging: string
    try {
      staging = await run.staging
    } catch (err) {
      this.end(run)
      throw err
    }
    if (this.current !== run) return
    let worker: ImportWorker
    try {
      worker = this.startWorker({ zips, staging })
    } catch (err) {
      this.end(run)
      throw err
    }
    run.worker = worker
    this.onStatus({ state: 'running', progress: { phase: 'reading', done: 0, total: 0 } })
    worker.on('message', (message) => {
      if (this.current !== run || run.landing) return
      if (message.type === 'progress') {
        this.onStatus({ state: 'running', progress: message.progress })
      } else if (message.type === 'error') {
        this.end(run, { state: 'failed', message: message.message })
      } else {
        run.landing = true
        void worker.terminate()
        this.onStatus({ state: 'running', progress: { phase: 'finishing', done: 0, total: 0 } })
        void workspace.landImport(message.manifest, staging).then(
          (result: ImportResult) =>
            this.end(run, { state: 'done', ...result }, () => Promise.resolve()),
          (err: unknown) => this.end(run, { state: 'failed', message: landingError(err) })
        )
      }
    })
    worker.on('error', (err) => {
      if (!run.landing)
        this.end(run, { state: 'failed', message: `The import failed: ${err.message}` })
    })
    worker.on('exit', () => {
      if (!run.landing)
        this.end(run, { state: 'failed', message: 'The import stopped unexpectedly.' })
    })
  }

  /** Stops a running import and deletes what it staged; too late once it is being added. */
  async cancel(): Promise<boolean> {
    const run = this.current
    if (!run || run.landing) return false
    this.end(run, { state: 'cancelled' })
    if (this.cleanup) await this.cleanup
    return true
  }

  /** Waits for a running import to finish landing, or cancels it before it lands. */
  async stop(): Promise<void> {
    const run = this.current
    if (run?.landing) await run.settled
    else if (run) await this.cancel()
    if (this.cleanup) await this.cleanup
  }

  /**
   * Frees the slot and reports the final status, then tears the run down in the background.
   * The status comes first so a new import can never be followed by a stale one.
   */
  private end(
    run: Run,
    status?: ImportStatus,
    teardown: () => Promise<void> = () => this.teardown(run)
  ): void {
    if (this.current !== run) return
    this.current = null
    run.settle()
    if (status) this.onStatus(status)
    const cleanup: Promise<void> = teardown()
      .catch(() => {})
      .finally(() => {
        if (this.cleanup === cleanup) this.cleanup = null
      })
    this.cleanup = cleanup
  }

  private async teardown(run: Run): Promise<void> {
    await run.worker?.terminate()
    const staging = await run.staging.catch(() => null)
    if (staging) await run.workspace.discardImport(staging)
  }
}

function landingError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC') return 'Not enough disk space.'
  return `The import failed: ${err instanceof Error ? err.message : String(err)}`
}
