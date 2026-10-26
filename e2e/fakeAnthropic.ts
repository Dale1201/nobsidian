import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const GOOD_KEY = 'sk-ant-api03-test-key-a1b2'

/** One scripted answer to POST /v1/messages. */
export interface FakeReply {
  /** Streamed as a text block. */
  text?: string
  /** Streamed as a tool call whose input is { markdown }. */
  tool?: { name: string; markdown: string }
  /** How many pieces the text or tool input is cut into. */
  chunks?: number
  /** Pause before each piece, in milliseconds. */
  delayMs?: number
  /** Stop after the first piece until release() is called. */
  hold?: boolean
  /** Close the connection after the first piece. */
  drop?: boolean
  /** Answer with this HTTP status and an error body instead of a stream. */
  status?: number
  errorType?: string
  errorMessage?: string
  retryAfter?: number
  /** Send an error event after the first piece. */
  streamError?: string
  stopReason?: 'end_turn' | 'max_tokens' | 'refusal' | 'tool_use'
  model?: string
  usage?: { input_tokens: number; output_tokens: number }
}

export interface RecordedRequest {
  method: string
  path: string
  headers: IncomingMessage['headers']
  body: Record<string, unknown> | null
}

const ERROR_TYPES: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  429: 'rate_limit_error',
  500: 'api_error',
  529: 'overloaded_error'
}

function pieces(text: string, count: number): string[] {
  const size = Math.max(1, Math.ceil(text.length / count))
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out.length ? out : ['']
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A local stand-in for api.anthropic.com that speaks the real streaming protocol. */
export class FakeAnthropic {
  readonly requests: RecordedRequest[] = []
  private queue: FakeReply[] = []
  private releases: (() => void)[] = []
  private open = new Set<ServerResponse>()

  private constructor(
    private readonly server: Server,
    readonly url: string
  ) {}

  static async start(): Promise<FakeAnthropic> {
    let fake: FakeAnthropic | null = null
    const server = createServer((req, res) => void fake!.handle(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    fake = new FakeAnthropic(server, `http://127.0.0.1:${port}`)
    return fake
  }

  /** Queues answers for the next requests; once they run out, each answer is "OK.". */
  reply(...replies: FakeReply[]): void {
    this.queue.push(...replies)
  }

  /** Lets held streams finish. */
  release(): void {
    for (const release of this.releases.splice(0)) release()
  }

  /** The bodies of the message requests so far. */
  messages(): Record<string, unknown>[] {
    return this.requests.filter((r) => r.path === '/v1/messages').map((r) => r.body!)
  }

  async close(): Promise<void> {
    this.release()
    for (const res of this.open) res.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString()
    const path = (req.url ?? '').split('?')[0]
    this.requests.push({
      method: req.method ?? '',
      path,
      headers: req.headers,
      body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null
    })
    // The SDK sends the key as a bearer token; older clients use x-api-key.
    const key = req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '')
    if (key !== GOOD_KEY) return this.error(res, { status: 401, errorMessage: 'invalid x-api-key' })
    if (path === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }))
      return
    }
    if (path !== '/v1/messages') return this.error(res, { status: 404, errorMessage: 'not found' })
    const reply = this.queue.shift() ?? { text: 'OK.' }
    if (reply.status) return this.error(res, reply)
    await this.stream(res, reply, (this.requests.at(-1)!.body!.model as string) ?? 'claude')
  }

  private error(res: ServerResponse, reply: FakeReply): void {
    const status = reply.status ?? 500
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (reply.retryAfter) headers['retry-after'] = String(reply.retryAfter)
    res.writeHead(status, headers)
    res.end(
      JSON.stringify({
        type: 'error',
        error: {
          type: reply.errorType ?? ERROR_TYPES[status] ?? 'api_error',
          message: reply.errorMessage ?? 'Something went wrong.'
        }
      })
    )
  }

  private async stream(res: ServerResponse, reply: FakeReply, model: string): Promise<void> {
    this.open.add(res)
    res.on('close', () => this.open.delete(res))
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const event = (type: string, data: object): void => {
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
    }
    const usage = reply.usage ?? { input_tokens: 2300, output_tokens: 450 }
    event('message_start', {
      message: {
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model: reply.model ?? model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: usage.input_tokens, output_tokens: 1 }
      }
    })
    const tool = reply.tool
    event('content_block_start', {
      index: 0,
      content_block: tool
        ? { type: 'tool_use', id: 'toolu_fake', name: tool.name, input: {} }
        : { type: 'text', text: '' }
    })
    const body = tool ? JSON.stringify({ markdown: tool.markdown }) : (reply.text ?? '')
    const parts = pieces(body, reply.chunks ?? 4)
    for (const [i, part] of parts.entries()) {
      if (reply.delayMs) await sleep(reply.delayMs)
      if (res.destroyed) return
      event('content_block_delta', {
        index: 0,
        delta: tool
          ? { type: 'input_json_delta', partial_json: part }
          : { type: 'text_delta', text: part }
      })
      if (i > 0) continue
      if (reply.hold) await new Promise<void>((resolve) => this.releases.push(resolve))
      if (res.destroyed) return
      if (reply.drop) {
        // After a moment, so the first piece is on its way, as when a network goes mid-answer.
        await sleep(100)
        return void res.destroy()
      }
      if (reply.streamError) {
        event('error', {
          error: { type: reply.streamError, message: 'Overloaded' }
        })
        return void res.end()
      }
    }
    event('content_block_stop', { index: 0 })
    event('message_delta', {
      delta: {
        stop_reason: reply.stopReason ?? (tool ? 'tool_use' : 'end_turn'),
        stop_sequence: null
      },
      usage: { output_tokens: usage.output_tokens }
    })
    event('message_stop', {})
    res.end()
  }
}
