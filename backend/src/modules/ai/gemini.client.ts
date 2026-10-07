import { GoogleGenAI } from '@google/genai'
import { AppError } from '../../core/errors.js'
import logger from '../../core/logger.js'

/**
 * Shared Gemini access for the AI module.
 *
 * Two problems motivated this module:
 *  - every AI entry point used to build its own `GoogleGenAI` client and read `GEMINI_MODEL`
 *    directly, so the documented `GEMINI_MODEL_FALLBACK` was never used and a retired model ID
 *    turned into a hard 503 for the whole admin form;
 *  - provider-error classification was duplicated per call site.
 *
 * The client runs a small model chain (primary → fallback). It falls back to the next model only
 * when the failure is about the model itself, stays on the same model for transient provider
 * errors (with backoff that honours `Retry-After`), and never falls back on authentication
 * failures, because a second model cannot fix a bad key.
 */

const DEFAULT_PRIMARY_MODEL = 'gemini-3.8-flash'
const DEFAULT_FALLBACK_MODEL = 'gemini-2.5-flash'
const DEFAULT_ATTEMPTS_PER_MODEL = 3
const DEFAULT_TIMEOUT_MS = 20_000
const BASE_BACKOFF_MS = 250
const MAX_BACKOFF_MS = 8_000
const MAX_RETRY_AFTER_MS = 15_000

export interface GeminiGenerateInput {
  contents: string
  systemInstruction: string
  temperature: number
  maxOutputTokens: number
  responseMimeType?: string
  responseSchema?: unknown
}

/** Everything the provider needs for one attempt, so tests can fake the transport. */
export interface GeminiAttempt {
  model: string
  contents: string
  systemInstruction: string
  temperature: number
  maxOutputTokens: number
  responseMimeType?: string
  responseSchema?: unknown
}

/** Returns the raw response text, or null when the provider answered without text. */
export type GeminiTransport = (attempt: GeminiAttempt) => Promise<string | null>

export type GeminiLogLevel = 'info' | 'warn' | 'error'
export type GeminiLog = (level: GeminiLogLevel, payload: Record<string, unknown>, message: string) => void

export interface GeminiClientOptions {
  apiKey?: string
  modelChain?: string[]
  transport?: GeminiTransport
  log?: GeminiLog
  sleep?: (milliseconds: number) => Promise<void>
  attemptsPerModel?: number
  timeoutMs?: number
}

export interface GeminiClient {
  isConfigured(): boolean
  modelChain: string[]
  generate(input: GeminiGenerateInput): Promise<{ text: string; model: string }>
}

/** Model chain: explicit override first, then the documented fallback, then the built-in default. */
export function getGeminiModelChain(env: NodeJS.ProcessEnv = process.env): string[] {
  const primary = env.GEMINI_MODEL?.trim()
  const fallback = env.GEMINI_MODEL_FALLBACK?.trim()
  const chain = [primary || DEFAULT_PRIMARY_MODEL, fallback || DEFAULT_FALLBACK_MODEL]
  return [...new Set(chain)]
}

export function getProviderStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown }
  const status = candidate.status ?? candidate.statusCode ?? candidate.code
  return typeof status === 'number' ? status : undefined
}

export function getProviderCategory(error: unknown): string {
  const status = getProviderStatus(error)
  if (status === 401 || status === 403) return 'authentication'
  if (status === 404) return 'model_not_found'
  if (status === 429) return 'rate_limited'
  if (status !== undefined && status >= 500) return 'provider_unavailable'
  if (error instanceof Error && /timeout|timed out|network|fetch failed|econn/i.test(error.message)) return 'network'
  return 'provider_error'
}

export function isRetryable(error: unknown): boolean {
  const status = getProviderStatus(error)
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || getProviderCategory(error) === 'network'
}

/**
 * A retired or unavailable model must switch models instead of failing, so unrecognised-model
 * signals are treated as a model problem even when the provider reports a generic status.
 */
export function isModelUnavailable(error: unknown): boolean {
  if (getProviderCategory(error) === 'model_not_found') return true
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /model.{0,40}?(?:not found|not supported|unsupported|does not exist|is not available|unknown model|invalid)/i.test(message)
    || /INVALID_ARGUMENT.{0,80}?model/i.test(message)
}

function readRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { retryAfter?: unknown; retry_after?: unknown; headers?: unknown; response?: { headers?: unknown } }
  const direct = candidate.retryAfter ?? candidate.retry_after
  const header = (candidate.headers ?? candidate.response?.headers) as Record<string, unknown> | undefined
  const raw = direct ?? (header ? (header['retry-after'] ?? header['Retry-After']) : undefined)
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.min(raw > 1000 ? raw : raw * 1000, MAX_RETRY_AFTER_MS)
  if (typeof raw === 'string' && raw.trim()) {
    const seconds = Number(raw.trim())
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS)
  }
  return null
}

const sleepFor = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

function defaultLog(level: GeminiLogLevel, payload: Record<string, unknown>, message: string): void {
  logger[level](payload, message)
}

export function createGeminiClient(options: GeminiClientOptions = {}): GeminiClient {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY?.trim() ?? ''
  const modelChain = options.modelChain ?? getGeminiModelChain()
  const attemptsPerModel = options.attemptsPerModel ?? DEFAULT_ATTEMPTS_PER_MODEL
  const log = options.log ?? defaultLog
  const sleep = options.sleep ?? sleepFor
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let transport = options.transport ?? null
  const resolveTransport = (): GeminiTransport => {
    if (transport) return transport
    if (!apiKey) throw new AppError(503, 'AI is not configured.')
    const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } })
    transport = async (attempt) => {
      const response = await ai.models.generateContent({
        model: attempt.model,
        contents: attempt.contents,
        config: {
          systemInstruction: attempt.systemInstruction,
          temperature: attempt.temperature,
          maxOutputTokens: attempt.maxOutputTokens,
          ...(attempt.responseMimeType ? { responseMimeType: attempt.responseMimeType } : {}),
          ...(attempt.responseSchema ? { responseSchema: attempt.responseSchema } : {}),
        },
      })
      return response.text ?? null
    }
    return transport
  }

  return {
    isConfigured: () => Boolean(apiKey) || Boolean(options.transport),
    modelChain,
    async generate(input) {
      const call = resolveTransport()
      let lastError: unknown = null

      for (let index = 0; index < modelChain.length; index += 1) {
        const model = modelChain[index]
        const hasFallback = index < modelChain.length - 1

        for (let attempt = 0; attempt < attemptsPerModel; attempt += 1) {
          try {
            const text = await call({ model, ...input })
            const trimmed = text?.trim()
            if (!trimmed) throw new AppError(502, 'AI returned an empty response.')
            return { text: trimmed, model }
          } catch (error) {
            lastError = error
            if (error instanceof AppError) throw error
            if (getProviderCategory(error) === 'authentication') throw error
            if (isModelUnavailable(error)) {
              log('warn', { model, category: getProviderCategory(error), hasFallback }, 'Gemini model is unavailable')
              break
            }
            if (!isRetryable(error) || attempt === attemptsPerModel - 1) throw error
            const backoff = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
            const delay = Math.max(readRetryAfterMs(error) ?? 0, backoff)
            log('warn', { model, attempt: attempt + 1, category: getProviderCategory(error), delay }, 'Retrying transient Gemini error')
            await sleep(delay)
          }
        }

        if (hasFallback) {
          log('warn', { model, next: modelChain[index + 1] }, 'Falling back to the secondary Gemini model')
        }
      }

      throw lastError ?? new AppError(502, 'AI request failed.')
    },
  }
}

let sharedClient: GeminiClient | null = null

/** Lazy singleton so a missing key stays a request-time 503 instead of a boot failure. */
export function getGeminiClient(): GeminiClient {
  sharedClient ??= createGeminiClient()
  return sharedClient
}
