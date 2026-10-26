import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFileAtomic } from '../workspace/fs-utils'

export interface KeyCodec {
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

/** Shows enough of a key to recognise it, and nothing that would let anyone use it. */
export function keyHint(key: string): string {
  const tail = key.slice(-4)
  return key.startsWith('sk-ant-') ? `sk-ant-…${tail}` : `…${tail}`
}

/** The Anthropic API key, encrypted at rest; it never leaves the main process. */
export class KeyStore {
  private cached: string | null | undefined

  constructor(
    private readonly file: string,
    private readonly codec: KeyCodec
  ) {}

  available(): boolean {
    return this.codec.available()
  }

  async get(): Promise<string | null> {
    if (this.cached !== undefined) return this.cached
    try {
      this.cached = this.codec.decrypt(await readFile(this.file))
    } catch {
      this.cached = null
    }
    return this.cached
  }

  async set(key: string): Promise<void> {
    if (!this.codec.available()) throw new Error('Encryption is not available on this Mac.')
    await mkdir(dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, this.codec.encrypt(key))
    await chmod(this.file, 0o600)
    this.cached = key
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true })
    this.cached = null
  }
}
