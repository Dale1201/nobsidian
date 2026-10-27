import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFileAtomic } from '../workspace/fs-utils'

export interface KeyCodec {
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

interface StoredKey {
  hint: string
  encrypted: string
}

/** Shows enough of a key to recognise it, and nothing that would let anyone use it. */
export function keyHint(key: string): string {
  const tail = key.slice(-4)
  return key.startsWith('sk-ant-') ? `sk-ant-…${tail}` : `…${tail}`
}

/**
 * The Anthropic API key, encrypted at rest; it never leaves the main process.
 * Only saving or using the key reaches the codec, since on macOS that asks for Keychain access.
 */
export class KeyStore {
  private cached: string | null | undefined

  constructor(
    private readonly file: string,
    private readonly codec: KeyCodec
  ) {}

  available(): boolean {
    return this.codec.available()
  }

  async hint(): Promise<string | null> {
    return (await this.read())?.hint ?? null
  }

  /** Rejects when the key can't be decrypted, such as when Keychain access is denied. */
  async get(): Promise<string | null> {
    if (this.cached !== undefined) return this.cached
    const stored = await this.read()
    this.cached = stored ? this.codec.decrypt(Buffer.from(stored.encrypted, 'base64')) : null
    return this.cached
  }

  async set(key: string): Promise<void> {
    if (!this.codec.available()) throw new Error('Encryption is not available on this Mac.')
    const stored: StoredKey = {
      hint: keyHint(key),
      encrypted: this.codec.encrypt(key).toString('base64')
    }
    await mkdir(dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify(stored))
    await chmod(this.file, 0o600)
    this.cached = key
  }

  async clear(): Promise<void> {
    await rm(this.file, { force: true })
    this.cached = null
  }

  private async read(): Promise<StoredKey | null> {
    try {
      const stored = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StoredKey>
      return typeof stored.hint === 'string' && typeof stored.encrypted === 'string'
        ? { hint: stored.hint, encrypted: stored.encrypted }
        : null
    } catch {
      return null
    }
  }
}
