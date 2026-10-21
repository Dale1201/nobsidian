import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from './fs-utils'

export const APP_DIR = '.nobsidian'
export const ROOT_ORDER_KEY = 'root'

export interface WorkspaceState {
  version: 1
  /** Parent page id (or "root") -> ordered child page ids. */
  order: Record<string, string[]>
  favorites: string[]
}

const empty = (): WorkspaceState => ({ version: 1, order: {}, favorites: [] })

export async function loadState(root: string): Promise<WorkspaceState> {
  try {
    const raw = JSON.parse(await readFile(join(root, APP_DIR, 'workspace.json'), 'utf8'))
    return {
      version: 1,
      order: typeof raw.order === 'object' && raw.order ? raw.order : {},
      favorites: Array.isArray(raw.favorites) ? raw.favorites : []
    }
  } catch {
    return empty()
  }
}

export async function saveState(root: string, state: WorkspaceState): Promise<void> {
  await mkdir(join(root, APP_DIR), { recursive: true })
  await writeFileAtomic(
    join(root, APP_DIR, 'workspace.json'),
    JSON.stringify(state, null, 2) + '\n'
  )
}
