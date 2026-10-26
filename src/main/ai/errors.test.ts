import Anthropic from '@anthropic-ai/sdk'
import { expect, it } from 'vitest'
import { aiError } from './errors'

const status = (code: number, body: object, headers: Record<string, string> = {}): Error =>
  Anthropic.APIError.generate(code, body, undefined, new Headers(headers))

it('names a rejected key', () => {
  expect(
    aiError(
      status(401, {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' }
      })
    )
  ).toEqual({
    kind: 'auth',
    message: 'Your API key was rejected.'
  })
})

it('says when to retry after a rate limit', () => {
  const body = { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }
  expect(aiError(status(429, body, { 'retry-after': '12' })).message).toBe(
    'Too many requests right now. Try again in 12 seconds.'
  )
  expect(aiError(status(429, body)).message).toBe(
    'Too many requests right now. Try again in a moment.'
  )
})

it('treats overloaded and server errors as busy, with or without a status', () => {
  const overloaded = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
  expect(aiError(status(529, overloaded)).kind).toBe('busy')
  expect(
    aiError(status(500, { type: 'error', error: { type: 'api_error', message: 'x' } })).kind
  ).toBe('busy')
  // How the SDK reports an error event in the middle of a stream.
  const inStream = new Anthropic.APIError(
    undefined,
    overloaded,
    undefined,
    new Headers(),
    'overloaded_error'
  )
  expect(aiError(inStream).kind).toBe('busy')
})

it("passes other request errors through in Anthropic's words", () => {
  const body = {
    type: 'error',
    error: { type: 'invalid_request_error', message: 'Your credit balance is too low.' }
  }
  expect(aiError(status(400, body))).toEqual({
    kind: 'request',
    message: 'Anthropic said: Your credit balance is too low.'
  })
})

it('treats connection failures, timeouts and anything else as the network', () => {
  const network = "Can't reach Anthropic. Check your internet connection."
  expect(aiError(new Anthropic.APIConnectionError({ message: 'fetch failed' })).message).toBe(
    network
  )
  expect(aiError(new Anthropic.APIConnectionTimeoutError()).kind).toBe('network')
  expect(aiError(new TypeError('socket hang up')).kind).toBe('network')
})
