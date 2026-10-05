import axios from 'axios'

import { isRecord } from './normalize.js'

/**
 * API-Football / API-Sports HTTP client.
 *
 * The key travels in the `x-apisports-key` header (the documented scheme for the direct
 * api-sports.io endpoint) and never in the query string, so URLs are safe to log.
 *
 * Requests are always scoped to one league and season plus a bounded date window: the unscoped
 * `/fixtures?from&to` sweep returned every competition in the world, which duplicated
 * football-data.org coverage and burned the daily quota.
 */

const DEFAULT_BASE_URL = 'https://v3.football.api-sports.io'
const UPSTREAM_TIMEOUT_MS = 10_000
/** API-Football's Free plan allows 100 requests per day. */
const DEFAULT_DAILY_REQUEST_LIMIT = 100

export function getApiFootballKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.API_FOOTBALL_KEY?.trim() || undefined
}

export function isApiFootballConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(getApiFootballKey(env))
}

export function getApiFootballBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.API_FOOTBALL_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function getApiFootballDailyRequestLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.API_FOOTBALL_DAILY_REQUEST_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_REQUEST_LIMIT
}

/** Fetches one league's fixtures for a bounded date window; returns the raw payload for normalization. */
export async function fetchApiFootballFixtures(
  leagueId: number,
  season: number,
  from: string,
  to: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const apiKey = getApiFootballKey(env)
  if (!apiKey) throw new Error('API_FOOTBALL_KEY is not configured')

  const response = await axios.get<unknown>(`${getApiFootballBaseUrl(env)}/fixtures`, {
    params: { league: leagueId, season, from, to },
    headers: {
      'x-apisports-key': apiKey,
      Accept: 'application/json',
    },
    timeout: UPSTREAM_TIMEOUT_MS,
  })

  // A provider refusal must never reach normalization: it looks exactly like a legitimate empty list.
  throwIfApiFootballErrors(response.data)

  return response.data
}

/** API-Football error classes: an entitlement refusal, or any other error the provider reports. */
export type ApiFootballErrorKind = 'plan' | 'provider'

/**
 * Entitlement refusals ("Free plans do not have access to this season, try from 2022 to 2024")
 * only change when the account's plan does, so they are worth remembering for longer than a
 * transient failure.
 */
const PLAN_ERROR_PATTERN = /(\bplan\b|\bplans\b|\bsubscription\b|\bentitlement\b|\bupgrade\b|do(?:es)? not have access)/i

function describeApiFootballError(value: unknown, field?: string): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [`${field ? `${field}: ` : ''}${trimmed}`] : []
  }
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap((entry) => describeApiFootballError(entry, field))
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([nestedField, nestedValue]) =>
      describeApiFootballError(nestedValue, field ? `${field}.${nestedField}` : nestedField),
    )
  }
  return [`${field ? `${field}: ` : ''}${String(value)}`]
}

/**
 * Extracts the messages from an API-Football response envelope's `errors` field.
 *
 * API-Football reports failures inside an HTTP 200 body — `errors: { plan: "..." }` — and uses an
 * empty `errors` (`{}` or `[]`) for a healthy response, so an empty `errors` must never be read as
 * a failure and a non-empty one must never be read as a legitimate empty fixture list.
 */
export function getApiFootballErrorMessages(payload: unknown): string[] {
  if (!isRecord(payload)) return []
  const errors = payload.errors
  if (errors === null || errors === undefined) return []
  if (typeof errors === 'string') return describeApiFootballError(errors)
  if (Array.isArray(errors)) return describeApiFootballError(errors)
  if (isRecord(errors)) {
    return Object.entries(errors).flatMap(([field, value]) => describeApiFootballError(value, field))
  }
  return describeApiFootballError(errors)
}

export function hasApiFootballErrors(payload: unknown): boolean {
  return getApiFootballErrorMessages(payload).length > 0
}

/** True when the provider refused the request because of the account's plan/entitlement. */
function isApiFootballPlanError(messages: readonly string[]): boolean {
  return messages.some((message) => PLAN_ERROR_PATTERN.test(message))
}

/** A provider error reported inside an otherwise-successful HTTP response. */
export class ApiFootballResponseError extends Error {
  readonly kind: ApiFootballErrorKind
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`API-Football provider error: ${issues.join('; ') || 'unknown error'}`)
    this.name = 'ApiFootballResponseError'
    this.kind = isApiFootballPlanError(issues) ? 'plan' : 'provider'
    this.issues = issues
  }
}

/** Turns a provider-reported error into a thrown failure so it can never be mistaken for `[]`. */
export function throwIfApiFootballErrors(payload: unknown): void {
  if (!hasApiFootballErrors(payload)) return
  throw new ApiFootballResponseError(getApiFootballErrorMessages(payload))
}

/** Provider messages are logged, so the API key must never be able to appear inside them. */
export function redactApiFootballSecrets(message: string, env: NodeJS.ProcessEnv = process.env): string {
  const apiKey = getApiFootballKey(env)
  return apiKey ? message.split(apiKey).join('[redacted]') : message
}

export function getApiFootballProviderStatus(error: unknown): number | string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.name : 'unknown'
  return error.response?.status ?? error.code ?? 'network-error'
}
