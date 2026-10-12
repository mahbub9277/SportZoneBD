/**
 * ZiniPay Advanced Transaction Verification API client (the two-step `verify` + `confirm` flow).
 *
 * This is a different product from the hosted checkout: it verifies a transaction the customer tells us about
 * (a bKash TrxID) against the provider's own transaction records, and it is the capability the paid
 * "Transaction ID verification" package provides. It is deliberately separate from the invoice flow — a
 * different endpoint group (`/v1/trx/`), a different response shape and a different failure vocabulary — so the
 * two can never be confused for each other.
 *
 * Contract, taken from https://zinipay.com/docs/trx-verification (read directly, not inferred):
 * - both calls are `POST` on `https://api.zinipay.com/v1/trx/` with the brand key in `zinipay-api-key`;
 * - `/verify` takes `{ transactionId, amount }` or `{ smsRef, amount }`, returns masked sender data and an
 *   internal numeric `id`, and deducts one verification credit;
 * - `/confirm` takes `{ transactionId, amount, id }` and permanently consumes the transaction, returning the
 *   unmasked sender — it is irreversible and is never called as a probe;
 * - documented errors: 400 amount mismatch, 400 already used, 402 INSUFFICIENT_CREDITS, 402 CREDITS_EXPIRED,
 *   403 FEATURE_DISABLED ("enable it from the dashboard"), 404 not found, confirm 400 id mismatch,
 *   confirm 403 "Device is not connected with the service", 500.
 *
 * The API key never leaves this module: it is not logged, not echoed into an error and never returned.
 */
import axios from 'axios'
import { toFiniteNumber, toMeaningfulString, toTrimmedString, maskPhoneNumber } from './providerValue.js'

const DEFAULT_TRX_BASE_URL = 'https://api.zinipay.com/v1/trx'
const DEFAULT_TIMEOUT_MS = 20_000

/**
 * Whether transaction verification may be attempted at all.
 *
 * Off unless the deployment says otherwise: this call spends a verification credit and consumes the
 * transaction irreversibly, so it must be switched on deliberately once the provider has enabled the feature
 * for the account.
 */
export const TRX_VERIFICATION_FLAG = 'ZINIPAY_TRX_VERIFICATION_ENABLED'

export type ZiniPayTrxFailureKind =
  /** The deployment has not switched the capability on. */
  | 'not-enabled'
  /** The provider has no API key configured here. */
  | 'not-configured'
  /** 403 FEATURE_DISABLED: the provider has not enabled the feature for this account/service. */
  | 'feature-disabled'
  /** 402 INSUFFICIENT_CREDITS / CREDITS_EXPIRED: the account cannot pay for more verifications. */
  | 'no-credits'
  /** A correctly-shaped refusal we do not have a specific word for. */
  | 'invalid-request'
  /** 404: the provider has no such transaction. */
  | 'not-found'
  /** The transaction was already used (verified and consumed) somewhere. */
  | 'already-used'
  /** The transaction exists but its amount is not the amount we asked about. */
  | 'amount-mismatch'
  /** confirm 403: the account's device is not connected, so nothing can be confirmed. */
  | 'device-offline'
  /** A 2xx answer we do not understand well enough to trust. */
  | 'malformed'
  | 'timeout'
  | 'network'
  | 'provider-error'

/** What the customer is told, by failure kind. Never contains provider wording, ids or amounts of other people. */
const USER_MESSAGE_BY_KIND: Record<ZiniPayTrxFailureKind, string> = {
  'not-enabled': 'Transaction ID verification is not switched on for this store yet.',
  'not-configured': 'Transaction ID verification is not configured for this store yet.',
  'feature-disabled': 'Transaction ID verification is not enabled for this payment account yet.',
  'no-credits': 'Transaction ID verification is temporarily unavailable. Our team has been notified.',
  'invalid-request': 'That transaction could not be verified. Please check the transaction ID and try again.',
  'not-found': 'We could not find that transaction yet. If you have just paid, wait a minute and try again.',
  'already-used': 'That transaction has already been used for a payment. If you believe this is wrong, contact support.',
  'amount-mismatch': 'That transaction is for a different amount, so it does not match this purchase.',
  'device-offline': 'Transaction verification is temporarily unavailable. Our team has been notified.',
  malformed: 'The payment provider sent an answer we could not trust, so nothing was activated.',
  timeout: 'The payment provider did not answer in time. Nothing was activated; please try again.',
  network: 'The payment provider could not be reached. Nothing was activated; please try again.',
  'provider-error': 'The payment provider is temporarily unavailable. Nothing was activated; please try again.',
}

export class ZiniPayTrxFailure extends Error {
  readonly kind: ZiniPayTrxFailureKind
  readonly status: number | null
  /** The provider's own machine-readable code, when it sent one (`FEATURE_DISABLED`, …). */
  readonly providerCode: string | null
  /** A short sentence safe to show a customer. */
  readonly userMessage: string

  constructor(kind: ZiniPayTrxFailureKind, status: number | null, detail?: string, providerCode: string | null = null) {
    super(detail ? `${kind}: ${detail}` : kind)
    this.name = 'ZiniPayTrxFailure'
    this.kind = kind
    this.status = status
    this.providerCode = providerCode
    this.userMessage = USER_MESSAGE_BY_KIND[kind]
  }

  /** True when the outcome is unknown rather than refused: the provider may or may not have acted. */
  get isAmbiguous(): boolean {
    return this.kind === 'timeout' || this.kind === 'network' || this.kind === 'provider-error'
  }
}

export interface ZiniPayTrxVerifyResult {
  /** The provider's internal numeric id, required by the confirm step. */
  id: number
  /** The transaction reference as the provider echoed it. */
  transactionId: string
  amount: number
  senderMasked: string | null
  /** The wallet, as reported (`bKash`). */
  provider: string | null
  /** The provider's own state for the transaction; only `UNUSED` may be confirmed. */
  status: string
  timestamp: string | null
}

export interface ZiniPayTrxConfirmResult {
  id: number | null
  transactionId: string | null
  amount: number | null
  senderMasked: string | null
  provider: string | null
  timestamp: string | null
}

export interface ZiniPayTrxHttpResponse {
  status: number
  data: unknown
}

export interface ZiniPayTrxHttp {
  post: (url: string, body: unknown, options: { headers: Record<string, string>; timeout: number }) => Promise<ZiniPayTrxHttpResponse>
}

export interface ZiniPayTrxDeps {
  env?: NodeJS.ProcessEnv
  http?: ZiniPayTrxHttp
  timeoutMs?: number
}

export function isTrxVerificationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[TRX_VERIFICATION_FLAG] ?? '').trim().toLowerCase() === 'true'
}

export function getTrxApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.ZINIPAY_API_KEY?.trim() || undefined
}

export function isTrxVerificationConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTrxVerificationEnabled(env) && Boolean(getTrxApiKey(env))
}

export function getTrxBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ZINIPAY_TRX_BASE_URL?.trim() || DEFAULT_TRX_BASE_URL).replace(/\/+$/, '')
}

function getTimeoutMs(env: NodeJS.ProcessEnv, override?: number): number {
  if (override && Number.isFinite(override) && override > 0) return Math.floor(override)
  const raw = Number(env.ZINIPAY_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_TIMEOUT_MS
}

const defaultHttp: ZiniPayTrxHttp = {
  post: async (url, body, options) => {
    // Every answer arrives here, so the mapping below is the only place a status becomes a failure kind.
    const response = await axios.post(url, body, { ...options, validateStatus: () => true })
    return { status: response.status, data: response.data }
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The provider's own message, trimmed and bounded; used for classification and logs, never shown to a customer. */
function providerMessage(data: unknown): string | null {
  if (!isRecord(data)) return null
  const candidate = data.message ?? data.error ?? data.msg
  const trimmed = toTrimmedString(candidate)
  return trimmed ? trimmed.slice(0, 200).toLowerCase() : null
}

function providerCode(data: unknown): string | null {
  if (!isRecord(data)) return null
  return toMeaningfulString(data.code)?.toUpperCase() ?? null
}

/**
 * Turns a documented provider refusal into a failure kind.
 *
 * The code is trusted first (the documentation defines `FEATURE_DISABLED`, `INSUFFICIENT_CREDITS` and
 * `CREDITS_EXPIRED`), and only the document's own wording is matched otherwise — no fuzzy guessing, so an
 * unrecognised refusal stays a generic `invalid-request` instead of being reported as something it is not.
 */
function classifyRefusal(status: number, data: unknown): ZiniPayTrxFailure {
  const code = providerCode(data)
  const message = providerMessage(data) ?? ''
  const detail = message.slice(0, 200) || `HTTP ${status}`

  if (code === 'FEATURE_DISABLED' || message.includes('enable it from the dashboard') || message.includes('not enabled for your service')) {
    return new ZiniPayTrxFailure('feature-disabled', status, detail, code)
  }
  if (code === 'INSUFFICIENT_CREDITS' || code === 'CREDITS_EXPIRED') {
    return new ZiniPayTrxFailure('no-credits', status, detail, code)
  }
  if (message.includes('already used') || message.includes('already been used')) {
    return new ZiniPayTrxFailure('already-used', status, detail, code)
  }
  if (message.includes('amount must be equal')) {
    return new ZiniPayTrxFailure('amount-mismatch', status, detail, code)
  }
  if (message.includes('device is not connected')) {
    return new ZiniPayTrxFailure('device-offline', status, detail, code)
  }
  if (status === 404 || message.includes('transaction not found') || message.includes('not found')) {
    return new ZiniPayTrxFailure('not-found', status, detail, code)
  }
  if (status >= 500) {
    return new ZiniPayTrxFailure('provider-error', status, detail, code)
  }
  return new ZiniPayTrxFailure('invalid-request', status, detail, code)
}

async function post(deps: ZiniPayTrxDeps, endpoint: 'verify' | 'confirm', body: Record<string, unknown>) {
  const env = deps.env ?? process.env

  if (!isTrxVerificationEnabled(env)) {
    throw new ZiniPayTrxFailure('not-enabled', null, `${TRX_VERIFICATION_FLAG} is not set to true`)
  }

  const apiKey = getTrxApiKey(env)
  if (!apiKey) {
    // Not a provider failure: the integration is simply not configured in this environment.
    throw new ZiniPayTrxFailure('not-configured', null, 'ZINIPAY_API_KEY is not configured')
  }

  const http = deps.http ?? defaultHttp
  let response: ZiniPayTrxHttpResponse

  try {
    response = await http.post(`${getTrxBaseUrl(env)}/${endpoint}`, body, {
      headers: {
        'zinipay-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: getTimeoutMs(env, deps.timeoutMs),
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    const isTimeout = code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test((error as Error)?.message ?? '')
    throw new ZiniPayTrxFailure(isTimeout ? 'timeout' : 'network', null, String(code ?? (error as Error)?.name ?? 'unknown'))
  }

  if (response.status < 200 || response.status >= 300) {
    throw classifyRefusal(response.status, response.data)
  }

  if (!isRecord(response.data)) {
    throw new ZiniPayTrxFailure('malformed', response.status, 'unexpected response body')
  }

  return response
}

/** The documented envelope: `{ statusCode, success, message, data }`. */
function readEnvelope(data: unknown, status: number): Record<string, unknown> {
  if (!isRecord(data)) {
    throw new ZiniPayTrxFailure('malformed', status, 'the answer is not an object')
  }
  if (data.success === false) {
    // A 2xx with `success:false` is still a refusal, and must never be read as a verification.
    throw classifyRefusal(status, data)
  }
  if (!isRecord(data.data)) {
    throw new ZiniPayTrxFailure('malformed', status, 'the answer has no data object')
  }
  return data.data
}

export interface VerifyTransactionParams {
  /** The customer's transaction reference. Passed on unchanged apart from trimming. */
  transactionId: string
  /** The amount that must match, taken from the payment record and never from the client. */
  amount: number
}

/**
 * Step one: pre-check the transaction, deduct one credit and return masked data.
 *
 * A refusal (unknown transaction, wrong amount, already used, …) is thrown as a classified failure, so a caller
 * can never mistake "verified" for "the provider said something".
 */
export async function verifyZiniPayTransaction(
  params: VerifyTransactionParams,
  deps: ZiniPayTrxDeps = {},
): Promise<ZiniPayTrxVerifyResult> {
  const response = await post(deps, 'verify', { transactionId: params.transactionId, amount: params.amount })
  const data = readEnvelope(response.data, response.status)

  const id = toFiniteNumber(data.id)
  if (id === null || !Number.isFinite(id)) {
    throw new ZiniPayTrxFailure('malformed', response.status, 'the answer has no transaction id')
  }

  const status = toMeaningfulString(data.status)
  if (!status) {
    throw new ZiniPayTrxFailure('malformed', response.status, 'the answer has no transaction status')
  }

  const amount = toFiniteNumber(data.amount)
  if (amount === null) {
    throw new ZiniPayTrxFailure('malformed', response.status, 'the answer has no amount')
  }

  const transactionId = toMeaningfulString(data.trxID) ?? toMeaningfulString(data.transactionId)
  if (!transactionId) {
    throw new ZiniPayTrxFailure('malformed', response.status, 'the answer has no transaction reference')
  }

  // The documentation defines one usable state, `UNUSED`. Anything else means the transaction is not available
  // for this purchase, so it is treated as already used rather than being confirmed blindly.
  if (status.toUpperCase() !== 'UNUSED') {
    throw new ZiniPayTrxFailure('already-used', response.status, `transaction status ${status.toUpperCase()}`)
  }

  return {
    id,
    transactionId,
    amount,
    senderMasked: maskPhoneNumber(toMeaningfulString(data.sender)),
    provider: toMeaningfulString(data.provider),
    status,
    timestamp: toMeaningfulString(data.timestamp),
  }
}

export interface ConfirmTransactionParams {
  transactionId: string
  amount: number
  /** The id returned by verify. */
  id: number
}

/**
 * Step two: permanently consume the transaction.
 *
 * Irreversible by the provider's own documentation, so it is only ever called for a transaction that was just
 * verified for this payment, and never as a probe.
 */
export async function confirmZiniPayTransaction(
  params: ConfirmTransactionParams,
  deps: ZiniPayTrxDeps = {},
): Promise<ZiniPayTrxConfirmResult> {
  const response = await post(deps, 'confirm', {
    transactionId: params.transactionId,
    amount: params.amount,
    id: params.id,
  })
  const data = readEnvelope(response.data, response.status)

  return {
    id: toFiniteNumber(data.id),
    transactionId: toMeaningfulString(data.transactionId) ?? toMeaningfulString(data.trxID),
    amount: toFiniteNumber(data.amount),
    // The confirm answer carries the sender unmasked; only the masked form is ever kept.
    senderMasked: maskPhoneNumber(toMeaningfulString(data.senderNumber) ?? toMeaningfulString(data.sender)),
    provider: toMeaningfulString(data.provider),
    timestamp: toMeaningfulString(data.timestamp),
  }
}

/** The provider status/code for a failure, for logs. Never includes the request or the API key. */
export function getTrxStatus(error: unknown): number | string {
  if (error instanceof ZiniPayTrxFailure) return error.status ?? error.kind
  if (axios.isAxiosError(error)) return error.response?.status ?? error.code ?? 'network-error'
  return error instanceof Error ? error.name : 'unknown'
}
