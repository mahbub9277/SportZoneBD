import axios from 'axios'

/**
 * CricketData.org (CricAPI) HTTP client.
 *
 * Unlike API-Football, this provider requires the key as a **query parameter**. Request URLs are
 * therefore never logged, echoed, or included in errors — only the endpoint name is.
 */

const DEFAULT_BASE_URL = 'https://api.cricapi.com/v1'
const UPSTREAM_TIMEOUT_MS = 10_000
/** CricketData's free tier is limited per day; measured in requests. */
const DEFAULT_DAILY_REQUEST_LIMIT = 100
/** `/currentMatches` returns live and imminent matches; `/matches` is the paginated full list. */
const DEFAULT_ENDPOINT = 'currentMatches'

export function getCricketApiKey(): string | undefined {
  return process.env.CRICKET_API_KEY?.trim() || undefined
}

export function isCricketDataConfigured(): boolean {
  return Boolean(getCricketApiKey())
}

export function getCricketBaseUrl(): string {
  return (process.env.CRICKET_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function getCricketEndpoint(): string {
  const configured = process.env.CRICKET_MATCHES_ENDPOINT?.trim() || DEFAULT_ENDPOINT
  return configured.replace(/^\/+/, '')
}

export function getCricketDailyRequestLimit(): number {
  const raw = Number(process.env.CRICKET_DAILY_REQUEST_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_REQUEST_LIMIT
}

/**
 * Fetches one page of cricket matches. The key rides in `apikey` because that is the provider's
 * required scheme; nothing from this request is logged verbatim.
 */
export async function fetchCricketMatches(): Promise<unknown> {
  const apiKey = getCricketApiKey()
  if (!apiKey) throw new Error('CRICKET_API_KEY is not configured')

  const response = await axios.get<unknown>(`${getCricketBaseUrl()}/${getCricketEndpoint()}`, {
    params: { apikey: apiKey, offset: 0 },
    headers: { Accept: 'application/json' },
    timeout: UPSTREAM_TIMEOUT_MS,
  })

  return response.data
}

export function getCricketProviderStatus(error: unknown): number | string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.name : 'unknown'
  return error.response?.status ?? error.code ?? 'network-error'
}
