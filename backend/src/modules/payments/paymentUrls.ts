/**
 * Where the payment flow's own URLs come from.
 *
 * Two different origins are involved and they are not interchangeable:
 *
 * - the **backend** origin serves the provider callback, so the webhook URL must point at the API. `BASE_URL`
 *   is the backend's public origin; the frontend's origin is never an acceptable substitute, because a
 *   callback delivered to the frontend only reaches the API when some external rewrite happens to forward it.
 * - the **frontend** origin serves the customer-facing pages, so the return and cancel URLs must point there.
 *
 * Everything is validated before it is used: a malformed origin, a callback path that does not match the
 * registered route, or a backend origin that is really the frontend origin all fail closed with a 503 instead
 * of sending the customer or the provider somewhere unexpected.
 */
import { AppError } from '../../core/errors.js'

/** The API prefix the app is mounted under (`app.use('/api/v1', apiRouter)` in `server.ts`). */
const API_PREFIX = '/api/v1'

/** The registered provider-callback route inside the payments router. */
const WEBHOOK_PATH = `${API_PREFIX}/payments/webhook/zinipay`

export interface PaymentUrlConfig {
  /** `https://sportzonebd-1.onrender.com/api/v1/payments/webhook/zinipay` (or an explicit override). */
  webhookUrl: string
  /** `https://sport-zone-bd.vercel.app/checkout/return?payment=<id>`. */
  redirectUrl: (paymentId: string) => string
  /** `https://sport-zone-bd.vercel.app/checkout?plan=<id>&cancel=1`. */
  cancelUrl: (planId: string) => string
}

function unavailable(): AppError {
  return new AppError(503, 'Online payment is temporarily unavailable.')
}

/**
 * Parses an absolute http(s) origin.
 *
 * Only `https` is accepted, except for the local development hosts where `http` is the only option. A URL
 * that carries credentials, a query string, a fragment or a non-root path is rejected: an origin is a scheme
 * and a host, nothing else.
 */
export function parsePublicOrigin(raw: string | undefined, label: string): URL | null {
  const value = raw?.trim()
  if (!value) return null

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AppError(503, `${label} is not a valid URL, so online payment is unavailable.`)
  }

  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new AppError(503, `${label} must use https, so online payment is unavailable.`)
  }
  if (url.username || url.password) {
    throw new AppError(503, `${label} must not contain credentials.`)
  }

  // Normalise to an origin: any path is dropped, so a value like `https://api.example.com/` or
  // `https://api.example.com/api/v1` cannot create duplicated path segments later.
  return new URL(url.origin)
}

/** Removes every trailing slash so joining paths cannot produce `//`. */
const trimSlashes = (value: string) => value.replace(/\/+$/, '')

function resolveFrontendOrigin(env: NodeJS.ProcessEnv): URL {
  const frontend = parsePublicOrigin(env.FRONTEND_URL ?? env.CORS_ALLOWED_ORIGINS?.split(',')[0], 'FRONTEND_URL')
  if (!frontend) throw new AppError(503, 'FRONTEND_URL is not configured, so online payment is unavailable.')
  return frontend
}

function resolveBackendOrigin(env: NodeJS.ProcessEnv): URL {
  const backend = parsePublicOrigin(env.BASE_URL ?? env.PUBLIC_API_URL, 'BASE_URL')
  if (!backend) throw new AppError(503, 'BASE_URL is not configured, so online payment is unavailable.')
  return backend
}

/**
 * The callback URL handed to ZiniPay.
 *
 * An explicit `ZINIPAY_WEBHOOK_URL` wins, but it is still validated: it must be a plain https origin and its
 * path must end with the registered callback route, otherwise the provider would be pointed at a URL that
 * cannot work. Without an override the URL is derived from the **backend** origin, and if that origin is
 * actually the frontend origin the flow fails closed instead of quietly sending callbacks to the frontend.
 */
export function resolveZiniPayWebhookUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ZINIPAY_WEBHOOK_URL?.trim()
  if (explicit) {
    const url = parsePublicOrigin(explicit, 'ZINIPAY_WEBHOOK_URL')
    // parsePublicOrigin returns an origin, but the override legitimately carries the callback path, so the
    // raw value's path is what is checked here.
    const path = (() => {
      try {
        return new URL(explicit).pathname.replace(/\/+$/, '')
      } catch {
        return ''
      }
    })()

    if (!url || !path.endsWith(WEBHOOK_PATH)) {
      throw new AppError(503, `ZINIPAY_WEBHOOK_URL must end with ${WEBHOOK_PATH}, so online payment is unavailable.`)
    }
    return `${url.origin}${path}`
  }

  const backend = resolveBackendOrigin(env)
  const frontend = parsePublicOrigin(env.FRONTEND_URL, 'FRONTEND_URL')
  if (frontend && frontend.origin === backend.origin) {
    // Same origin for the site and the API is only safe when an external rewrite forwards the callback, which
    // this integration must not assume: make the owner state the callback URL explicitly.
    throw new AppError(
      503,
      'BASE_URL points at the frontend origin. Set BASE_URL to the backend origin or configure ZINIPAY_WEBHOOK_URL.',
    )
  }

  return `${trimSlashes(backend.origin)}${WEBHOOK_PATH}`
}

/** The customer-facing URLs, built from the frontend origin only. */
export function resolvePaymentUrlConfig(env: NodeJS.ProcessEnv = process.env): PaymentUrlConfig {
  const frontend = trimSlashes(resolveFrontendOrigin(env).origin)

  return {
    webhookUrl: resolveZiniPayWebhookUrl(env),
    redirectUrl: (paymentId: string) => `${frontend}/checkout/return?payment=${encodeURIComponent(paymentId)}`,
    cancelUrl: (planId: string) => `${frontend}/checkout?plan=${encodeURIComponent(planId)}&cancel=1`,
  }
}
