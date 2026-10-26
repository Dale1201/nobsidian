import { useApp } from '../store'
import { useAi } from './aiStore'

/** Whether AI is shown at all, and whether it can run right now. */
export function useAiAccess(): { shown: boolean; online: boolean; ready: boolean } {
  const shown = useApp((s) => s.settings?.ai?.enabled ?? true)
  const online = useAi((s) => s.online)
  const hasKey = useAi((s) => s.status?.hasKey ?? false)
  return { shown, online, ready: shown && online && hasKey }
}
