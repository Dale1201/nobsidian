import { watch } from 'chokidar'
import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import type { FileChange } from '../../shared/types'
import { APP_DIR, STATE_FILE } from './state'
import { ATTACHMENTS_DIR } from './workspace'

const FILE_EVENTS = new Set(['add', 'addDir', 'change', 'unlink', 'unlinkDir'])

/** Events arriving within this window are reconciled together. */
export const BATCH_MS = 150

export interface WorkspaceWatcher {
  /** Resolves once the initial scan is done and changes are being reported. */
  ready: Promise<void>
  close: () => Promise<void>
}

export function watchWorkspace(
  root: string,
  onChanges: (changes: FileChange[]) => void,
  onError: (err: unknown) => void
): WorkspaceWatcher {
  // FSEvents reports real paths, so a root reached through a symlink must be resolved first.
  const real = realpathSync.native(root)
  const rel = (abs: string): string => relative(real, abs).split(sep).join('/')
  let pending: FileChange[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    timer = null
    const batch = pending
    pending = []
    onChanges(batch)
  }
  const watcher = watch(real, {
    ignoreInitial: true,
    ignored: (abs) => isIgnored(rel(abs))
  })
  watcher.on('all', (kind, abs) => {
    if (!FILE_EVENTS.has(kind)) return
    pending.push({ kind: kind as FileChange['kind'], path: rel(abs) })
    timer ??= setTimeout(flush, BATCH_MS)
  })
  watcher.on('error', onError)
  const ready = new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
  return {
    ready,
    close: async () => {
      if (timer) clearTimeout(timer)
      await watcher.close()
    }
  }
}

/** Skips dot-files and folders (except the workspace state), attachments and temp files. */
export function isIgnored(path: string): boolean {
  if (path === '') return false
  const parts = path.split('/')
  if (parts[0] === APP_DIR)
    return !(parts.length === 1 || (parts.length === 2 && parts[1] === STATE_FILE))
  if (parts[0] === ATTACHMENTS_DIR) return true
  return parts.some((part) => part.startsWith('.'))
}
