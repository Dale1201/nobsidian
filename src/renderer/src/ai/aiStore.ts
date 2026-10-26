import { create } from 'zustand'
import type { AiKeyResult, AiStatus } from '@shared/ai'

const api = window.api

interface AiState {
  /** Null until the main process has answered. */
  status: AiStatus | null
  online: boolean
  refresh: () => Promise<void>
  setKey: (key: string) => Promise<AiKeyResult>
  clearKey: () => Promise<void>
}

export const useAi = create<AiState>()((set, get) => ({
  status: null,
  online: navigator.onLine,
  refresh: async () => {
    set({ status: await api.invoke('ai:status', undefined) })
  },
  setKey: async (key) => {
    const result = await api.invoke('ai:setKey', { key })
    if (result.ok) await get().refresh()
    return result
  },
  clearKey: async () => {
    await api.invoke('ai:clearKey', undefined)
    await get().refresh()
  }
}))

window.addEventListener('online', () => useAi.setState({ online: true }))
window.addEventListener('offline', () => useAi.setState({ online: false }))
