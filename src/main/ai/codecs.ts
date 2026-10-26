import { safeStorage } from 'electron'
import type { KeyCodec } from './keyStore'

export const safeStorageCodec: KeyCodec = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data)
}

// An unsigned test build would make macOS ask for Keychain access, which hangs a hidden test run.
export const testCodec: KeyCodec = {
  available: () => true,
  encrypt: (text) => Buffer.from(`e2e:${text}`),
  decrypt: (data) => data.toString().replace(/^e2e:/, '')
}
