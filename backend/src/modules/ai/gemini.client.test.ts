import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGeminiClient,
  getGeminiModelChain,
  getProviderCategory,
  getProviderStatus,
  isModelUnavailable,
  isRetryable,
  type GeminiAttempt,
} from './gemini.client.js'

const silent = () => {}
const providerError = (status: number, message = 'provider failure') => Object.assign(new Error(message), { status })

const attemptInput = {
  contents: 'extract these match details',
  systemInstruction: 'system instruction',
  temperature: 0.1,
  maxOutputTokens: 100,
}

const clientWith = (options: {
  transport: (attempt: GeminiAttempt) => Promise<string | null>
  modelChain?: string[]
  sleep?: (milliseconds: number) => Promise<void>
}) => createGeminiClient({
  apiKey: 'test-key',
  modelChain: options.modelChain ?? ['gemini-3.8-flash', 'gemini-2.5-flash'],
  transport: options.transport,
  log: silent,
  sleep: options.sleep ?? (async () => {}),
})

test('the model chain defaults to the primary model plus the configured fallback', () => {
  assert.deepEqual(getGeminiModelChain({} as NodeJS.ProcessEnv), ['gemini-3.8-flash', 'gemini-2.5-flash'])
  assert.deepEqual(
    getGeminiModelChain({ GEMINI_MODEL: 'custom-primary', GEMINI_MODEL_FALLBACK: 'custom-fallback' } as unknown as NodeJS.ProcessEnv),
    ['custom-primary', 'custom-fallback'],
  )
  assert.deepEqual(getGeminiModelChain({ GEMINI_MODEL: 'custom-primary' } as unknown as NodeJS.ProcessEnv), ['custom-primary', 'gemini-2.5-flash'])
})

test('the primary model is used when it answers', async () => {
  const calls: string[] = []
  const client = clientWith({
    transport: async (attempt) => {
      calls.push(attempt.model)
      return '  {"ok":true}  '
    },
  })

  const result = await client.generate(attemptInput)
  assert.equal(result.model, 'gemini-3.8-flash')
  assert.equal(result.text, '{"ok":true}')
  assert.deepEqual(calls, ['gemini-3.8-flash'])
})

test('an unavailable primary model falls back instead of failing the request', async () => {
  const calls: string[] = []
  const client = clientWith({
    transport: async (attempt) => {
      calls.push(attempt.model)
      if (attempt.model === 'gemini-3.8-flash') throw providerError(404, 'models/gemini-3.8-flash is not found')
      return '{"ok":true}'
    },
  })

  const result = await client.generate(attemptInput)
  assert.equal(result.model, 'gemini-2.5-flash')
  assert.deepEqual(calls, ['gemini-3.8-flash', 'gemini-2.5-flash'])
})

test('a transient provider error retries the same model with backoff before failing', async () => {
  const delays: number[] = []
  let attempts = 0
  const client = clientWith({
    sleep: async (milliseconds) => {
      delays.push(milliseconds)
    },
    transport: async () => {
      attempts += 1
      if (attempts < 3) throw providerError(503, 'service unavailable')
      return '{"ok":true}'
    },
  })

  const result = await client.generate(attemptInput)
  assert.equal(result.text, '{"ok":true}')
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [250, 500])
})

test('a retryable failure is not silently moved to another model once retries are exhausted', async () => {
  const calls: string[] = []
  const client = clientWith({
    transport: async (attempt) => {
      calls.push(attempt.model)
      throw providerError(429, 'rate limited')
    },
  })

  await assert.rejects(client.generate(attemptInput), (error: unknown) => getProviderStatus(error) === 429)
  assert.deepEqual(calls, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash'])
})

test('Retry-After is honoured when the provider asks for a longer wait', async () => {
  const delays: number[] = []
  let attempts = 0
  const client = clientWith({
    sleep: async (milliseconds) => {
      delays.push(milliseconds)
    },
    transport: async () => {
      attempts += 1
      if (attempts === 1) throw Object.assign(new Error('rate limited'), { status: 429, retryAfter: 3 })
      return '{"ok":true}'
    },
  })

  await client.generate(attemptInput)
  assert.deepEqual(delays, [3000])
})

test('an authentication failure never falls back to another model', async () => {
  const calls: string[] = []
  const client = clientWith({
    transport: async (attempt) => {
      calls.push(attempt.model)
      throw providerError(403, 'permission denied')
    },
  })

  await assert.rejects(client.generate(attemptInput), (error: unknown) => getProviderStatus(error) === 403)
  assert.deepEqual(calls, ['gemini-3.8-flash'])
})

test('a non-retryable client error is reported as-is', async () => {
  let attempts = 0
  const client = clientWith({
    transport: async () => {
      attempts += 1
      throw providerError(400, 'invalid request payload')
    },
  })

  await assert.rejects(client.generate(attemptInput), (error: unknown) => getProviderStatus(error) === 400)
  assert.equal(attempts, 1)
})

test('an empty provider response is an error instead of an empty suggestion', async () => {
  const client = clientWith({ transport: async () => '   ' })
  await assert.rejects(client.generate(attemptInput), (error: Error) => /empty response/i.test(error.message))
})

test('every model being unavailable surfaces the provider error', async () => {
  const client = clientWith({
    transport: async () => {
      throw providerError(404, 'models/x is not found')
    },
  })

  await assert.rejects(client.generate(attemptInput), (error: Error) => /not found/.test(error.message))
})

test('provider classification stays stable', () => {
  assert.equal(getProviderCategory(providerError(401)), 'authentication')
  assert.equal(getProviderCategory(providerError(403)), 'authentication')
  assert.equal(getProviderCategory(providerError(404)), 'model_not_found')
  assert.equal(getProviderCategory(providerError(429)), 'rate_limited')
  assert.equal(getProviderCategory(providerError(503)), 'provider_unavailable')
  assert.equal(getProviderCategory(new Error('fetch failed')), 'network')
  assert.equal(getProviderCategory(providerError(400)), 'provider_error')

  assert.equal(isRetryable(providerError(429)), true)
  assert.equal(isRetryable(providerError(503)), true)
  assert.equal(isRetryable(providerError(400)), false)
  assert.equal(isRetryable(providerError(403)), false)

  assert.equal(isModelUnavailable(providerError(404)), true)
  assert.equal(isModelUnavailable(new Error('models/gemini-9.9-flash is not found for API version v1beta')), true)
  assert.equal(isModelUnavailable(providerError(400, 'INVALID_ARGUMENT: model name is invalid')), true)
  assert.equal(isModelUnavailable(providerError(400, 'invalid request payload')), false)
})

test('the client reports configuration status without touching the network', () => {
  assert.equal(createGeminiClient({ apiKey: '', log: silent }).isConfigured(), false)
  assert.equal(createGeminiClient({ apiKey: 'key', log: silent }).isConfigured(), true)
  assert.equal(createGeminiClient({ transport: async () => 'ok', log: silent }).isConfigured(), true)
})
