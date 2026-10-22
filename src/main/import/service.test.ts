import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ImportStatus } from '../../shared/types'
import { APP_DIR } from '../workspace/state'
import { Workspace } from '../workspace/workspace'
import { runImport } from './pipeline'
import { ImportService, type ImportWorker } from './service'
import { FIXTURE_ZIP } from './test-zips'
import type { WorkerInput, WorkerMessage } from './types'

const opened: Workspace[] = []

afterEach(async () => {
  for (const ws of opened.splice(0)) {
    ws.close()
    await rm(ws.root, { recursive: true, force: true })
  }
})

async function openWorkspace(): Promise<Workspace> {
  const ws = await Workspace.open(await mkdtemp(join(tmpdir(), 'nb-service-')))
  opened.push(ws)
  return ws
}

/** A promise that a test resolves by hand. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void
  const wait = new Promise<void>((resolve) => (open = resolve))
  return { wait, open }
}

const stubFetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch

/** Runs the import in-process, like the worker thread does. */
class InProcessWorker extends EventEmitter implements ImportWorker {
  terminated = false
  /** Settles once the import has run, or was skipped because the worker was terminated first. */
  readonly run: Promise<void>

  constructor(input: WorkerInput, hold?: Promise<void>) {
    super()
    this.run = (async () => {
      await hold
      if (this.terminated) return
      await runImport({
        ...input,
        fetch: stubFetch,
        onProgress: (progress) => this.post({ type: 'progress', progress })
      }).then(
        (manifest) => this.post({ type: 'done', manifest }),
        (err: Error) => this.post({ type: 'error', message: err.message })
      )
    })()
  }

  private post(message: WorkerMessage): void {
    if (!this.terminated) this.emit('message', message)
  }

  async terminate(): Promise<number> {
    this.terminated = true
    return 1
  }
}

/** A worker the test drives by hand: it emits what the test says, when the test says. */
class ManualWorker extends EventEmitter implements ImportWorker {
  terminated = false
  input: WorkerInput

  constructor(input: WorkerInput) {
    super()
    this.input = input
  }

  async terminate(): Promise<number> {
    this.terminated = true
    return 1
  }
}

async function setup(holds: (Promise<void> | undefined)[] = []): Promise<{
  ws: Workspace
  service: ImportService
  statuses: ImportStatus[]
  workers: InProcessWorker[]
  settled: () => Promise<ImportStatus>
}> {
  const ws = await openWorkspace()
  const statuses: ImportStatus[] = []
  const workers: InProcessWorker[] = []
  let notify: (() => void) | null = null
  const service = new ImportService(
    (input) => {
      const worker = new InProcessWorker(input, holds[workers.length])
      workers.push(worker)
      return worker
    },
    (status) => {
      statuses.push(status)
      if (status.state !== 'running') notify?.()
    }
  )
  const settled = (): Promise<ImportStatus> =>
    new Promise((resolve) => {
      const last = statuses[statuses.length - 1]
      if (last && last.state !== 'running') return resolve(last)
      notify = () => resolve(statuses[statuses.length - 1])
    })
  return { ws, service, statuses, workers, settled }
}

async function stagingFolders(ws: Workspace): Promise<string[]> {
  const names = await readdir(join(ws.root, APP_DIR)).catch(() => [] as string[])
  return names.filter((n) => n.startsWith('import-'))
}

describe('ImportService', () => {
  it('imports, lands the pages and reports each phase', async () => {
    const { ws, service, statuses, settled } = await setup()
    await service.start(ws, [FIXTURE_ZIP])
    const done = await settled()
    expect(done).toMatchObject({ state: 'done', pages: 10 })
    const phases = statuses.flatMap((s) => (s.state === 'running' ? [s.progress.phase] : []))
    expect(new Set(phases)).toEqual(new Set(['reading', 'converting', 'copying', 'finishing']))
    expect(ws.tree().map((n) => n.title)).toEqual(['Imported from Notion'])
    expect(service.running).toBe(false)
  })

  it('refuses a second import while one runs', async () => {
    const hold = gate()
    const { ws, service, settled } = await setup([hold.wait])
    await service.start(ws, [FIXTURE_ZIP])
    await expect(service.start(ws, [FIXTURE_ZIP])).rejects.toThrow('An import is already running.')
    hold.open()
    expect(await settled()).toMatchObject({ state: 'done' })
  })

  it('refuses a start that overlaps another start, and creates one worker', async () => {
    const { ws, service, workers, settled } = await setup()
    const results = await Promise.allSettled([
      service.start(ws, [FIXTURE_ZIP]),
      service.start(ws, [FIXTURE_ZIP])
    ])
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect((rejected[0].reason as Error).message).toBe('An import is already running.')
    expect(workers).toHaveLength(1)
    expect(await settled()).toMatchObject({ state: 'done' })
  })

  it('cancels before landing and removes the staging folder before cancel resolves', async () => {
    const hold = gate()
    const { ws, service, statuses, workers } = await setup([hold.wait])
    await service.start(ws, [FIXTURE_ZIP])
    expect(await service.cancel()).toBe(true)
    expect(statuses[statuses.length - 1]).toEqual({ state: 'cancelled' })
    expect(await stagingFolders(ws)).toEqual([])
    hold.open()
    await workers[0].run
    expect(await stagingFolders(ws)).toEqual([])
    expect(ws.tree()).toEqual([])
  })

  it('a new import started right after a cancel reports only its own statuses', async () => {
    const hold = gate()
    const { ws, service, statuses, settled } = await setup([hold.wait])
    await service.start(ws, [FIXTURE_ZIP])
    // Slow the cancel's cleanup so a new start can overlap it.
    const cleanupGate = gate()
    const discard = ws.discardImport.bind(ws)
    ws.discardImport = async (staging) => {
      await cleanupGate.wait
      await discard(staging)
    }
    const cancelled = service.cancel()
    hold.open()
    setTimeout(cleanupGate.open, 100)
    const starting = service.start(ws, [FIXTURE_ZIP])
    expect(await cancelled).toBe(true)
    await starting
    expect(await settled()).toMatchObject({ state: 'done', pages: 10 })
    expect(statuses.slice(0, 2).map((s) => s.state)).toEqual(['running', 'cancelled'])
  })

  it('reports a failed import and leaves the workspace untouched', async () => {
    const { ws, service, settled } = await setup()
    await service.start(ws, [join(ws.root, 'missing.zip')])
    expect(await settled()).toEqual({
      state: 'failed',
      message: "This file isn't a zip, or it's damaged."
    })
    expect(ws.tree()).toEqual([])
  })

  it('reports the start failure, not a cleanup failure after it', async () => {
    const ws = await openWorkspace()
    ws.discardImport = async () => {
      throw new Error('disk gone')
    }
    const service = new ImportService(
      () => {
        throw new Error('no worker available')
      },
      () => {}
    )
    await expect(service.start(ws, [FIXTURE_ZIP])).rejects.toThrow('no worker available')
    expect(service.running).toBe(false)
  })

  it('fails and removes the staging folder when the worker exits without finishing', async () => {
    const ws = await openWorkspace()
    const workers: ManualWorker[] = []
    const statuses: ImportStatus[] = []
    const service = new ImportService(
      (input) => {
        const worker = new ManualWorker(input)
        workers.push(worker)
        return worker
      },
      (status) => statuses.push(status)
    )
    await service.start(ws, [FIXTURE_ZIP])
    workers[0].emit('exit', 1)
    await service.stop()
    expect(statuses[statuses.length - 1]).toEqual({
      state: 'failed',
      message: 'The import stopped unexpectedly.'
    })
    expect(service.running).toBe(false)
    expect(await stagingFolders(ws)).toEqual([])
  })

  it('cannot cancel once the import is landing, and the import still lands', async () => {
    const ws = await openWorkspace()
    const workers: ManualWorker[] = []
    const statuses: ImportStatus[] = []
    const service = new ImportService(
      (input) => {
        const worker = new ManualWorker(input)
        workers.push(worker)
        return worker
      },
      (status) => statuses.push(status)
    )
    await service.start(ws, [FIXTURE_ZIP])
    const worker = workers[0]
    const manifest = await runImport({
      zips: worker.input.zips,
      staging: worker.input.staging,
      fetch: stubFetch
    })
    worker.emit('message', { type: 'done', manifest })
    expect(service.cancellable).toBe(false)
    expect(await service.cancel()).toBe(false)
    await service.stop()
    expect(statuses[statuses.length - 1]).toMatchObject({ state: 'done', pages: 10 })
    expect(ws.tree().map((n) => n.title)).toEqual(['Imported from Notion'])
  })
})
