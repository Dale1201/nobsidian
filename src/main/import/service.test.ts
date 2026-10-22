import { EventEmitter } from 'node:events'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ImportStatus } from '../../shared/types'
import { Workspace } from '../workspace/workspace'
import { runImport } from './pipeline'
import { ImportService, type ImportWorker } from './service'
import { FIXTURE_ZIP } from './test-zips'
import type { WorkerInput, WorkerMessage } from './types'

/** Runs the import in-process, like the worker thread does. */
class InProcessWorker extends EventEmitter implements ImportWorker {
  terminated = false
  constructor(input: WorkerInput, hold?: Promise<void>) {
    super()
    const post = (m: WorkerMessage): void => {
      if (!this.terminated) this.emit('message', m)
    }
    void (async () => {
      await hold
      await runImport({
        ...input,
        fetch: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
        onProgress: (progress) => post({ type: 'progress', progress })
      }).then(
        (manifest) => post({ type: 'done', manifest }),
        (err: Error) => post({ type: 'error', message: err.message })
      )
    })()
  }
  async terminate(): Promise<number> {
    this.terminated = true
    return 1
  }
}

async function setup(hold?: Promise<void>): Promise<{
  ws: Workspace
  service: ImportService
  statuses: ImportStatus[]
  settled: () => Promise<ImportStatus>
}> {
  const ws = await Workspace.open(await mkdtemp(join(tmpdir(), 'nb-service-')))
  const statuses: ImportStatus[] = []
  let notify: (() => void) | null = null
  const service = new ImportService(
    (input) => new InProcessWorker(input, hold),
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
  return { ws, service, statuses, settled }
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
    let release!: () => void
    const { ws, service } = await setup(new Promise((r) => (release = r)))
    await service.start(ws, [FIXTURE_ZIP])
    await expect(service.start(ws, [FIXTURE_ZIP])).rejects.toThrow('An import is already running.')
    release()
  })

  it('cancels before landing and deletes the staging folder', async () => {
    let release!: () => void
    const { ws, service, statuses } = await setup(new Promise((r) => (release = r)))
    await service.start(ws, [FIXTURE_ZIP])
    expect(await service.cancel()).toBe(true)
    release()
    expect(statuses[statuses.length - 1]).toEqual({ state: 'cancelled' })
    expect(ws.tree()).toEqual([])
    const appDir = await readdir(join(ws.root, '.nobsidian')).catch(() => [])
    expect(appDir.filter((n) => n.startsWith('import-'))).toEqual([])
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
})
