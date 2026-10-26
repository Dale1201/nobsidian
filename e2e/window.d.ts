import type { Api } from '../src/shared/ipc'

// What the preload script exposes, for code that tests run inside the window.
declare global {
  interface Window {
    api: Api
  }
}
