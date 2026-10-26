import Anthropic from '@anthropic-ai/sdk'
import type { AiError } from '../../shared/ai'

const NETWORK = "Can't reach Anthropic. Check your internet connection."

function retryAfterSeconds(headers: Headers | undefined): number | null {
  const value = Number(headers?.get('retry-after'))
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null
}

function apiMessage(error: InstanceType<typeof Anthropic.APIError>): string {
  const body = error.error as { error?: { message?: unknown } } | undefined
  const message = body?.error?.message
  return typeof message === 'string' && message ? message : error.message
}

export function aiError(error: unknown): AiError {
  if (error instanceof Anthropic.AuthenticationError) {
    return { kind: 'auth', message: 'Your API key was rejected.' }
  }
  if (error instanceof Anthropic.RateLimitError) {
    const seconds = retryAfterSeconds(error.headers)
    return {
      kind: 'rate',
      message: seconds
        ? `Too many requests right now. Try again in ${seconds} seconds.`
        : 'Too many requests right now. Try again in a moment.'
    }
  }
  if (error instanceof Anthropic.APIConnectionError) return { kind: 'network', message: NETWORK }
  if (error instanceof Anthropic.APIError) {
    // Errors sent inside a stream have a type but no status.
    const busy =
      (typeof error.status === 'number' && error.status >= 500) ||
      error.type === 'overloaded_error' ||
      error.type === 'api_error'
    if (busy) return { kind: 'busy', message: 'Claude is busy right now. Try again in a moment.' }
    return { kind: 'request', message: `Anthropic said: ${apiMessage(error)}` }
  }
  return { kind: 'network', message: NETWORK }
}
