import { handle, send } from '../ipc'
import type { AiService } from './service'

export function registerAiHandlers(ai: AiService): void {
  handle('ai:status', () => ai.status())
  handle('ai:setKey', ({ key }) => ai.setKey(key))
  handle('ai:clearKey', () => ai.clearKey())
  handle('ai:start', (request, event) => {
    void ai.start(request, (name, data) => send(event.sender, name, data))
  })
  handle('ai:cancel', ({ requestId }) => ai.cancel(requestId))
  handle('ai:end', ({ sessionId }) => ai.end(sessionId))
}
