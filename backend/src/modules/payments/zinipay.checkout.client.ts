import axios from 'axios'
import { toFiniteNumber, toMeaningfulString, toTrimmedString } from './providerValue.js'

/**
 * ZiniPay hosted payment (invoice/checkout) client.
 *
 * This is the product that provides the customer-facing payment page: SportZoneBD creates an invoice on the
 * server, sends the customer to the returned `payment_url`, and later proves the payment with
 * `POST /v1/payment/verify`. It is a different product from the Advanced Two-Step Transaction Verification
 * API (`/v1/trx/*`), which spends credits, has its own client (`zinipay.trx.client.ts`) and is never used for
 * the hosted checkout itself.
 *
 * Contract notes, all from the provider's own documentation and its live responses:
 * - auth header is `zini-api-key` (the same brand key the account uses);
 * - `cus_email` and `cancel_url` are required in practice even though the published table calls `cancel_url`
 *   optional, so both are always sent;
 * - `redirect_url` is what makes the hosted page return the customer to SportZoneBD;
 * - a merchant reference is supplied as `val_id`, and the invoice identifier is read from the response field
 *   `invoice_id`/`invoiceId` when present and otherwise from the identifier in `payment_url`, which is the
 *   format the provider's own Postman collection reads (`res.payment_url.split('/').pop()`);
 * - create answers 201 (the Postman collection shows 200), so any 2xx is accepted.
 *
 * The API key never leaves this module: it is not logged, not echoed into an error and never returned.
 */

const DEFAULT_BASE_URL = 'https://api.zinipay.com/v1/payment'
const DEFAULT_TIMEOUT_MS = 20_000

/**
 * Hosts a hosted payment page may live on.
 *
 * ZiniPay's own documentation returns `https://secure.zinipay.com/payment/INVOICE_ID` and its live sandbox
 * answers with the same host under `/testing/payment/test/...`, so exactly this host is trusted — not the
 * whole `zinipay.com` domain, and not any other subdomain. The API host (`api.zinipay.com`) is a different
 * host and is deliberately absent: it is an endpoint, never a redirect target.
 */
export const TRUSTED_PAYMENT_PAGE_HOSTS: readonly string[] = ['secure.zinipay.com']

/**
 * Validates the hosted payment page URL before it can reach a browser.
 *
 * Rejects anything that is not a plain https URL on an allow-listed host: non-https schemes, credentials in
 * the URL, explicit non-default ports, malformed values and unknown hosts. A rejected URL is reported as a
 * provider failure, which the caller turns into a failed payment — never into a redirect or a success.
 */
export function assertTrustedPaymentUrl(raw: string | null, hosts: readonly string[] = TRUSTED_PAYMENT_PAGE_HOSTS): string {
  if (!raw) throw new ZiniPayCheckoutFailure('provider-error', null, 'the invoice response has no payment url')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ZiniPayCheckoutFailure('provider-error', null, 'the payment url is not a valid URL')
  }

  if (url.protocol !== 'https:') {
    throw new ZiniPayCheckoutFailure('provider-error', null, `the payment url uses ${url.protocol}`)
  }
  if (url.username || url.password) {
    throw new ZiniPayCheckoutFailure('provider-error', null, 'the payment url contains credentials')
  }
  if (url.port !== '' && url.port !== '443') {
    throw new ZiniPayCheckoutFailure('provider-error', null, `the payment url uses port ${url.port}`)
  }
  if (!hosts.includes(url.hostname.toLowerCase())) {
    throw new ZiniPayCheckoutFailure('provider-error', null, `the payment url host is not trusted: ${url.hostname}`)
  }
  if (!url.pathname || url.pathname === '/') {
    throw new ZiniPayCheckoutFailure('provider-error', null, 'the payment url has no payment path')
  }

  // Returned rebuilt from the parsed parts, so nothing unparsed survives into a redirect target.
  return `${url.origin}${url.pathname}${url.search}`
}

/**
 * The invoice reference carried by a trusted hosted payment URL.
 *
 * ZiniPay's documentation states the invoice reference in the payment URL itself — the success example is
 * `{ "status": true, "message": "Invoice created successfully.", "payment_url":
 * "https://secure.zinipay.com/payment/INVOICE_ID" }` — and the live sandbox response confirms the equivalence:
 * its `invoice_id` (`test_000d0997-…`) was exactly the last path segment of its `payment_url`
 * (`https://secure.zinipay.com/testing/payment/test/test_000d0997-…`). Production answers with the documented
 * minimal shape (no separate id field), so this path segment is the documented identifier format.
 *
 * Only URLs that already passed {@link assertTrustedPaymentUrl} reach this function, so the host is trusted by
 * construction. The path must contain a `payment` segment and end in a single safe identifier segment: an
 * unexpected path shape is refused rather than interpreted, and nothing is invented when it does not match.
 */
export function extractInvoiceIdFromTrustedPaymentUrl(paymentUrl: string): string | null {
  let url: URL
  try {
    url = new URL(paymentUrl)
  } catch {
    return null
  }

  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  const paymentIndex = segments.lastIndexOf('payment')
  if (paymentIndex === -1) return null

  const candidate = segments[segments.length - 1]
  if (!candidate || candidate === 'payment') return null
  // Invoice references are opaque tokens (`test_000d0997-9f20-4989-89e9-f941d60876fa` in the sandbox). Anything
  // else — path traversal, markup, whitespace, query-looking values or an absurdly long value — is not treated
  // as an identifier, and the literal placeholder the documentation uses is rejected by the caller.
  if (!/^[A-Za-z0-9._~-]{4,100}$/.test(candidate)) return null
  if (candidate === '.' || candidate === '..') return null

  return candidate
}

export type ZiniPayCheckoutFailureKind =
  | 'not-configured'
  | 'invalid-request'
  | 'unauthorized'
  | 'not-found'
  | 'provider-error'
  | 'timeout'
  | 'network'

/**
 * What the provider answered, reduced to facts that are safe to log.
 *
 * Only the response's shape is captured — the top-level field names, whether the fields the flow depends on
 * were present, and the provider's own success indicator. No values are kept: not the payment URL (it carries
 * the invoice reference), not the customer details, never the API key. This is what makes a production
 * failure diagnosable from a log line without leaking anything.
 */
export interface ZiniPayResponseDiagnostics {
  httpStatus: number | null
  /** `payload.status`, when the provider sent a boolean one. */
  providerSuccess: boolean | null
  /** The top-level field names the provider returned, bounded in count and length. */
  fields: string[]
  hasPaymentUrl: boolean
  hasInvoiceId: boolean
  /** The payment url's host, which is a provider hostname rather than anything about the customer. */
  paymentUrlHost: string | null
  /** How many path segments the payment url has, so an unexpected path shape is visible without the path. */
  paymentUrlPathSegments: number | null
}

const MAX_DIAGNOSTIC_FIELDS = 20
const MAX_DIAGNOSTIC_FIELD_LENGTH = 40

/** Field names and shapes only: never values, never the payment url, never enough to paste a payload into a log. */
export function buildResponseDiagnostics(payload: unknown, httpStatus: number | null = null): ZiniPayResponseDiagnostics {
  if (!isRecord(payload)) {
    return {
      httpStatus,
      providerSuccess: null,
      fields: [],
      hasPaymentUrl: false,
      hasInvoiceId: false,
      paymentUrlHost: null,
      paymentUrlPathSegments: null,
    }
  }

  const rawPaymentUrl = toTrimmedString(payload.payment_url)
  let paymentUrlHost: string | null = null
  let paymentUrlPathSegments: number | null = null
  if (rawPaymentUrl) {
    try {
      const url = new URL(rawPaymentUrl)
      paymentUrlHost = url.hostname
      paymentUrlPathSegments = url.pathname.split('/').filter((segment) => segment !== '').length
    } catch {
      paymentUrlHost = null
    }
  }

  return {
    httpStatus,
    providerSuccess: typeof payload.status === 'boolean' ? payload.status : null,
    fields: Object.keys(payload)
      .slice(0, MAX_DIAGNOSTIC_FIELDS)
      .map((field) => field.slice(0, MAX_DIAGNOSTIC_FIELD_LENGTH)),
    hasPaymentUrl: rawPaymentUrl !== null,
    hasInvoiceId: toTrimmedString(payload.invoice_id) !== null || toTrimmedString(payload.invoiceId) !== null,
    paymentUrlHost,
    paymentUrlPathSegments,
  }
}

/**
 * The identifier strings the provider's own documentation uses as placeholders.
 *
 * ZiniPay's published success example is `"payment_url": "https://secure.zinipay.com/payment/INVOICE_ID"`,
 * where `INVOICE_ID` stands for an identifier rather than being one. Accepting it would send a customer to a
 * page that cannot be paid and could never be verified, so it is refused like any other unusable value.
 */
const PLACEHOLDER_INVOICE_IDS = new Set(['invoice_id', 'invoiceid'])

const USER_MESSAGE_BY_KIND: Record<ZiniPayCheckoutFailureKind, string> = {
  'not-configured': 'Online payment is temporarily unavailable.',
  'invalid-request': 'The payment provider rejected this payment request.',
  unauthorized: 'Online payment is temporarily unavailable.',
  'not-found': 'The payment provider does not recognise this payment session.',
  'provider-error': 'The payment provider is temporarily unavailable.',
  timeout: 'The payment provider did not answer in time.',
  network: 'The payment provider could not be reached.',
}

export class ZiniPayCheckoutFailure extends Error {
  readonly kind: ZiniPayCheckoutFailureKind
  readonly status: number | null
  /** A short sentence safe to show a customer. */
  readonly userMessage: string
  /** Safe, value-free description of the provider answer, for logs. */
  readonly diagnostics: ZiniPayResponseDiagnostics | null

  constructor(
    kind: ZiniPayCheckoutFailureKind,
    status: number | null,
    detail?: string,
    diagnostics: ZiniPayResponseDiagnostics | null = null,
  ) {
    super(detail ? `${kind}: ${detail}` : kind)
    this.name = 'ZiniPayCheckoutFailure'
    this.kind = kind
    this.status = status
    this.userMessage = USER_MESSAGE_BY_KIND[kind]
    this.diagnostics = diagnostics
  }

  /** True when the outcome is unknown rather than refused: the provider may or may not have acted. */
  get isAmbiguous(): boolean {
    return this.kind === 'timeout' || this.kind === 'network' || this.kind === 'provider-error'
  }
}

export interface ZiniPayInvoice {
  /** The provider's invoice reference, used for every later verification. */
  invoiceId: string
  /** The official hosted payment page. */
  paymentUrl: string
  /** `test` for a sandbox key, absent or `live` otherwise. */
  environment: string | null
}

export type ZiniPayInvoiceStatus = 'PENDING' | 'COMPLETED' | 'FAILED'

export interface ZiniPayInvoiceCheck {
  status: ZiniPayInvoiceStatus
  /** The invoice amount the provider reports, when it reports one. */
  amount: number | null
  /** The wallet the provider recorded, when the invoice has been paid. */
  paymentMethod: string | null
  transactionId: string | null
  /** The merchant reference the invoice was created with, echoed back. */
  merchantReference: string | null
  metadata: Record<string, unknown> | null
}

export interface ZiniPayHttpResponse {
  status: number
  data: unknown
}

export interface ZiniPayHttp {
  post: (url: string, body: unknown, options: { headers: Record<string, string>; timeout: number }) => Promise<ZiniPayHttpResponse>
}

export interface ZiniPayClientDeps {
  env?: NodeJS.ProcessEnv
  /** Transport, replaceable in tests. Defaults to axios. */
  http?: ZiniPayHttp
  timeoutMs?: number
}

export function getZiniPayApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.ZINIPAY_API_KEY?.trim() || undefined
}

export function isZiniPayCheckoutConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(getZiniPayApiKey(env))
}

export function getZiniPayPaymentBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.ZINIPAY_PAYMENT_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function getZiniPayTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ZINIPAY_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_TIMEOUT_MS
}

const defaultHttp: ZiniPayHttp = {
  post: async (url, body, options) => {
    // Every answer arrives here, so the mapping below is the only place a status becomes a failure kind.
    const response = await axios.post(url, body, { ...options, validateStatus: () => true })
    return { status: response.status, data: response.data }
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Provider text is only used for logs, trimmed and bounded. */
function describeProviderMessage(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined
  const candidate = data.message ?? data.error ?? data.msg
  if (typeof candidate !== 'string') return undefined
  const trimmed = candidate.trim()
  return trimmed ? trimmed.slice(0, 200) : undefined
}

/** Validation errors arrive as an envelope with an `errors` array; the first entry says what is missing. */
function describeValidationError(data: unknown): string | undefined {
  if (!isRecord(data) || !Array.isArray(data.errors)) return undefined
  const first = data.errors.find((entry) => isRecord(entry))
  if (!isRecord(first)) return undefined
  const field = toTrimmedString(first.field)
  const message = toTrimmedString(first.message)
  return field || message ? `${field ?? 'body'}: ${message ?? 'invalid'}` : undefined
}

function failureKindForStatus(status: number): ZiniPayCheckoutFailureKind {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not-found'
  if (status >= 500) return 'provider-error'
  return 'invalid-request'
}

async function post(deps: ZiniPayClientDeps, endpoint: 'create' | 'verify', body: Record<string, unknown>) {
  const env = deps.env ?? process.env
  const apiKey = getZiniPayApiKey(env)
  if (!apiKey) {
    // Not a provider failure: the integration is simply not configured in this environment.
    throw new ZiniPayCheckoutFailure('not-configured', null, 'ZINIPAY_API_KEY is not configured')
  }

  const http = deps.http ?? defaultHttp
  const timeout = deps.timeoutMs ?? getZiniPayTimeoutMs(env)
  let response: ZiniPayHttpResponse

  try {
    response = await http.post(`${getZiniPayPaymentBaseUrl(env)}/${endpoint}`, body, {
      headers: {
        'zini-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout,
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    const isTimeout = code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test((error as Error)?.message ?? '')
    throw new ZiniPayCheckoutFailure(isTimeout ? 'timeout' : 'network', null, String(code ?? (error as Error)?.name ?? 'unknown'))
  }

  if (response.status < 200 || response.status >= 300) {
    throw new ZiniPayCheckoutFailure(
      failureKindForStatus(response.status),
      response.status,
      describeValidationError(response.data) ?? describeProviderMessage(response.data) ?? `HTTP ${response.status}`,
      buildResponseDiagnostics(response.data, response.status),
    )
  }

  if (!isRecord(response.data)) {
    throw new ZiniPayCheckoutFailure('provider-error', response.status, 'unexpected response body', buildResponseDiagnostics(response.data, response.status))
  }

  return { payload: response.data, status: response.status }
}

export interface CreateZiniPayInvoiceParams {
  amount: number
  customerEmail: string
  customerName?: string | null
  /** Our own reference for this payment (`val_id`), unique per payment attempt. */
  merchantReference: string
  /** Where the hosted page returns the customer after a successful payment. */
  redirectUrl: string
  /** Where the customer is sent when they cancel. Required by the provider in practice. */
  cancelUrl: string
  /** Where the provider announces the payment update. Never trusted on its own. */
  webhookUrl: string
  /** Small JSON echo (ids only), bounded by the provider to 1 KB. */
  metadata?: Record<string, unknown>
}

/**
 * Creates the invoice behind the hosted payment page.
 *
 * No credits are involved in this call as far as any published source says (credits belong to the
 * transaction-verification product), but it is still called at most once per payment attempt: the caller
 * reuses a live session instead of creating a new invoice for the same purchase.
 */
export async function createZiniPayInvoice(
  params: CreateZiniPayInvoiceParams,
  deps: ZiniPayClientDeps = {},
): Promise<ZiniPayInvoice> {
  const { payload } = await post(deps, 'create', {
    cus_email: params.customerEmail,
    ...(params.customerName ? { cus_name: params.customerName } : {}),
    amount: params.amount,
    val_id: params.merchantReference,
    redirect_url: params.redirectUrl,
    cancel_url: params.cancelUrl,
    webhook_url: params.webhookUrl,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  })

  const diagnostics = buildResponseDiagnostics(payload)

  if (payload.status !== true) {
    throw new ZiniPayCheckoutFailure('invalid-request', null, describeProviderMessage(payload) ?? 'invoice refused', diagnostics)
  }

  // The hosted page is validated before anything is read out of it, so an unexpected host can never be
  // interpreted, stored, or handed to a browser.
  let paymentUrl: string
  try {
    paymentUrl = assertTrustedPaymentUrl(toTrimmedString(payload.payment_url))
  } catch (error) {
    if (error instanceof ZiniPayCheckoutFailure) {
      throw new ZiniPayCheckoutFailure(error.kind, error.status, error.message, diagnostics)
    }
    throw error
  }

  // Two documented sources, in order of specificity: the response field ZiniPay returns on its live
  // responses (`invoice_id`, also seen as `invoiceId`), then — for the documented minimal response that only
  // carries `{status, message, payment_url}` — the identifier the provider itself reads out of that URL.
  const invoiceId = toTrimmedString(payload.invoice_id)
    ?? toTrimmedString(payload.invoiceId)
    ?? extractInvoiceIdFromTrustedPaymentUrl(paymentUrl)

  if (!invoiceId || PLACEHOLDER_INVOICE_IDS.has(invoiceId.toLowerCase())) {
    throw new ZiniPayCheckoutFailure(
      'provider-error',
      null,
      `invoice response carries no usable invoice id (fields: ${diagnostics.fields.join(',') || 'none'}; host=${diagnostics.paymentUrlHost ?? 'n/a'}; segments=${diagnostics.paymentUrlPathSegments ?? 'n/a'})`,
      diagnostics,
    )
  }

  return { invoiceId, paymentUrl, environment: toMeaningfulString(payload.environment) }
}

/**
 * Checks an invoice with the provider.
 *
 * `COMPLETED` is the only status that means the money is received. The endpoint is repeatable (the provider
 * documents no consumption for it, unlike the transaction-verification confirm call), but callers still
 * throttle it so a page refresh cannot turn into a request storm.
 */
export async function verifyZiniPayInvoice(
  params: { invoiceId: string },
  deps: ZiniPayClientDeps = {},
): Promise<ZiniPayInvoiceCheck> {
  const { payload } = await post(deps, 'verify', { invoice_id: params.invoiceId })

  if (payload.status === false && !('invoice_id' in payload) && !('invoiceId' in payload)) {
    // A refusal envelope (`{status:false,message}`) is a provider answer, not an invoice state.
    throw new ZiniPayCheckoutFailure('invalid-request', null, describeProviderMessage(payload) ?? 'verification refused', buildResponseDiagnostics(payload))
  }

  const rawStatus = (toTrimmedString(payload.status) ?? '').toUpperCase()
  if (rawStatus !== 'PENDING' && rawStatus !== 'COMPLETED' && rawStatus !== 'FAILED') {
    throw new ZiniPayCheckoutFailure('provider-error', null, `unrecognised invoice status: ${rawStatus || 'missing'}`, buildResponseDiagnostics(payload))
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : null

  return {
    status: rawStatus,
    amount: toFiniteNumber(payload.amount),
    // The provider answers with placeholders (`unknown`, `N/A`) when it has neither of these, and a placeholder
    // must never be recorded as a wallet or a transaction reference.
    paymentMethod: toMeaningfulString(payload.payment_method) ?? toMeaningfulString(payload.provider),
    transactionId: toMeaningfulString(payload.transaction_id),
    merchantReference: toMeaningfulString(payload.val_id),
    metadata,
  }
}

/** The provider status/code for a failure, for logs. Never includes the request or the API key. */
export function getZiniPayCheckoutStatus(error: unknown): number | string {
  if (error instanceof ZiniPayCheckoutFailure) return error.status ?? error.kind
  if (axios.isAxiosError(error)) return error.response?.status ?? error.code ?? 'network-error'
  return error instanceof Error ? error.name : 'unknown'
}
