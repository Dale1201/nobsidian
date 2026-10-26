import Anthropic from '@anthropic-ai/sdk'
import type { AiError, AiKeyResult, AiMode, AiModel, AiStart, AiStatus } from '../../shared/ai'
import type { IpcEvents } from '../../shared/ipc'
import { createClient } from './client'
import { aiError } from './errors'
import { keyHint, type KeyStore } from './keyStore'
import { firstMessage, followUpMessage, modeFor, SYSTEM_PROMPT, toolsFor } from './prompts'
import type { UsageLedger } from './usage'

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock
type Tool = Anthropic.Beta.Messages.BetaTool
type Delta = Anthropic.Beta.Messages.BetaRawContentBlockDeltaEvent['delta']

export type AiSend = <E extends 'ai:delta' | 'ai:done' | 'ai:error'>(
  event: E,
  data: IpcEvents[E]
) => void

interface Session {
  messages: MessageParam[]
  tools: Tool[] | null
  mode: AiMode | null
  last: ContentBlock[] | null
}

export const MAX_TOKENS = 32_000
export const IDLE_TIMEOUT_MS = 60_000
const FALLBACK_MODELS: AiModel[] = ['claude-opus-5-5', 'claude-sonnet-5-5']

function deltaLength(delta: Delta): number {
  if (delta.type === 'text_delta') return delta.text.length
  if (delta.type === 'input_json_delta') return delta.partial_json.length
  if (delta.type === 'thinking_delta') return delta.thinking.length
  return 0
}

export interface AiServiceOptions {
  keys: KeyStore
  usage: UsageLedger
  model: () => AiModel
  client?: (key: string) => Anthropic
  idleTimeoutMs?: number
}

export class AiService {
  private sessions = new Map<string, Session>()
  private running = new Map<string, { sessionId: string; controller: AbortController }>()
  private readonly client: (key: string) => Anthropic

  constructor(private readonly options: AiServiceOptions) {
    this.client = options.client ?? createClient
  }

  async status(): Promise<AiStatus> {
    const key = await this.options.keys.get()
    const month = await this.options.usage.month()
    return {
      hasKey: key !== null,
      keyHint: key ? keyHint(key) : null,
      encryptionAvailable: this.options.keys.available(),
      month: { requests: month.requests, dollars: month.dollars }
    }
  }

  /** Saves a key only after Anthropic accepts it. */
  async setKey(raw: string): Promise<AiKeyResult> {
    const key = raw.trim()
    if (!key) return { ok: false, error: 'Paste your API key first.' }
    if (!this.options.keys.available()) {
      return { ok: false, error: "This Mac can't store the key safely, so it was not saved." }
    }
    try {
      await this.client(key).models.list({ limit: 1 })
    } catch (err) {
      const error = aiError(err)
      return {
        ok: false,
        error: error.kind === 'auth' ? 'Anthropic rejected this key.' : error.message
      }
    }
    await this.options.keys.set(key)
    return { ok: true }
  }

  async clearKey(): Promise<void> {
    await this.options.keys.clear()
  }

  cancel(requestId: string): void {
    this.running.get(requestId)?.controller.abort()
  }

  end(sessionId: string): void {
    this.sessions.delete(sessionId)
    for (const run of this.running.values()) {
      if (run.sessionId === sessionId) run.controller.abort()
    }
  }

  /** Streams one request; every outcome is reported through `send`, and it never rejects. */
  async start(request: AiStart, send: AiSend): Promise<void> {
    try {
      await this.stream(request, send)
    } catch (err) {
      send('ai:error', { requestId: request.requestId, ...aiError(err) })
    }
  }

  private async stream(request: AiStart, send: AiSend): Promise<void> {
    const { requestId } = request
    const fail = (error: AiError): void => send('ai:error', { requestId, ...error })
    const key = await this.options.keys.get()
    if (!key) return fail({ kind: 'auth', message: 'Add your Anthropic API key in Settings.' })

    const previous = this.sessions.get(request.sessionId)
    const session: Session =
      request.followUp && previous?.last
        ? previous
        : { messages: [], tools: toolsFor(request), mode: modeFor(request), last: null }
    const turn =
      session.last && request.followUp
        ? followUpMessage(session.last, request.instruction ?? '')
        : firstMessage(request)
    const messages = [...session.messages, turn]
    this.sessions.set(request.sessionId, session)

    const model = this.options.model()
    const controller = new AbortController()
    let idle: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const touch = (): void => {
      clearTimeout(idle)
      idle = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, this.options.idleTimeoutMs ?? IDLE_TIMEOUT_MS)
    }

    let mode: AiMode = session.mode ?? 'reply'
    let toolCalled = false
    const stream = this.client(key).beta.messages.stream(
      {
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
        output_config: { effort: 'low' },
        ...(session.tools ? { tools: session.tools, tool_choice: { type: 'auto' as const } } : {}),
        ...(FALLBACK_MODELS.includes(model)
          ? { fallbacks: 'default' as const, betas: ['server-side-fallback-2026-07-01'] }
          : {})
      },
      { signal: controller.signal }
    )
    this.running.set(requestId, { sessionId: request.sessionId, controller })
    touch()
    let received = 0
    stream.on('streamEvent', (event) => {
      touch()
      if (event.type === 'content_block_delta') received += deltaLength(event.delta)
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        const name = event.content_block.name
        if (name === 'edit' || name === 'insert' || name === 'reply') {
          mode = name
          toolCalled = true
        }
      }
    })
    stream.on('text', (_delta, text) => {
      if (!toolCalled) send('ai:delta', { requestId, mode, text })
    })
    stream.on('inputJson', (_delta, snapshot) => {
      const markdown = (snapshot as { markdown?: unknown } | null)?.markdown
      if (typeof markdown === 'string') send('ai:delta', { requestId, mode, text: markdown })
    })

    try {
      const message = await stream.finalMessage()
      await this.options.usage.add(message.model, message.usage).catch(() => {})
      // The API rejects an empty turn, or an empty text block, in a follow-up.
      const content = message.content.filter((block) => block.type !== 'text' || block.text)
      if (content.length) {
        session.messages = [...messages, { role: 'assistant', content }]
        session.last = content
      }
      if (message.stop_reason === 'refusal') {
        return fail({ kind: 'refusal', message: 'Claude declined this request.' })
      }
      if (message.stop_reason === 'max_tokens') {
        return fail({ kind: 'truncated', message: 'The response was cut off.' })
      }
      send('ai:done', { requestId })
    } catch (err) {
      // Output tokens are only reported at the end, so the text that arrived stands in for them.
      const partial = stream.currentMessage
      if (partial) {
        const output_tokens = Math.max(partial.usage.output_tokens, Math.ceil(received / 3))
        await this.options.usage
          .add(partial.model, { ...partial.usage, output_tokens })
          .catch(() => {})
      }
      if (controller.signal.aborted && !timedOut) return send('ai:done', { requestId })
      fail(timedOut ? { kind: 'network', message: aiError(null).message } : aiError(err))
    } finally {
      clearTimeout(idle)
      this.running.delete(requestId)
    }
  }
}
