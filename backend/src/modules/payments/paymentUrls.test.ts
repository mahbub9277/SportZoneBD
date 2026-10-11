import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePublicOrigin, resolvePaymentUrlConfig, resolveZiniPayWebhookUrl } from './paymentUrls.js'

/**
 * Which origin each URL comes from, asserted without a deployment.
 *
 * The two origins are the thing that broke in production planning: the callback must point at the backend and
 * the customer must be returned to the frontend, and neither may be silently substituted for the other.
 */

const FRONTEND = 'https://sport-zone-bd.vercel.app'
const BACKEND = 'https://sportzonebd-1.onrender.com'

const env = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  ({ FRONTEND_URL: FRONTEND, BASE_URL: BACKEND, ...overrides }) as NodeJS.ProcessEnv

test('the callback is derived from the backend origin and matches the registered route', () => {
  assert.equal(resolveZiniPayWebhookUrl(env()), `${BACKEND}/api/v1/payments/webhook/zinipay`)
})

test('a trailing slash or an api prefix on the configured origin cannot duplicate path segments', () => {
  assert.equal(resolveZiniPayWebhookUrl(env({ BASE_URL: `${BACKEND}/` })), `${BACKEND}/api/v1/payments/webhook/zinipay`)
  assert.equal(resolveZiniPayWebhookUrl(env({ BASE_URL: `${BACKEND}/api/v1` })), `${BACKEND}/api/v1/payments/webhook/zinipay`)
  assert.equal(
    resolveZiniPayWebhookUrl(env({ BASE_URL: `${BACKEND}/api/v1///` })),
    `${BACKEND}/api/v1/payments/webhook/zinipay`,
    'an origin is normalised, so no path from the configured value survives',
  )
})

test('an explicit webhook url wins and is normalised, as long as it points at the real route', () => {
  assert.equal(
    resolveZiniPayWebhookUrl(env({ ZINIPAY_WEBHOOK_URL: `${BACKEND}/api/v1/payments/webhook/zinipay` })),
    `${BACKEND}/api/v1/payments/webhook/zinipay`,
  )
  assert.equal(
    resolveZiniPayWebhookUrl(env({ ZINIPAY_WEBHOOK_URL: `${BACKEND}/api/v1/payments/webhook/zinipay///` })),
    `${BACKEND}/api/v1/payments/webhook/zinipay`,
    'trailing slashes are trimmed',
  )
  assert.equal(
    resolveZiniPayWebhookUrl(env({ ZINIPAY_WEBHOOK_URL: 'https://hooks.example.test/api/v1/payments/webhook/zinipay' })),
    'https://hooks.example.test/api/v1/payments/webhook/zinipay',
    'a callback host that differs from the API host is allowed when it names the real route',
  )
})

test('an explicit webhook url that does not name the route is refused instead of being used', () => {
  for (const value of [
    `${BACKEND}/api/v1/payments/webhook/bkash`,
    `${BACKEND}/payments/webhook/zinipay`,
    `${BACKEND}/api/v2/payments/webhook/zinipay`,
    `${BACKEND}/`,
  ]) {
    assert.throws(
      () => resolveZiniPayWebhookUrl(env({ ZINIPAY_WEBHOOK_URL: value })),
      (error: { statusCode?: number; message: string }) => error.statusCode === 503 && /ZINIPAY_WEBHOOK_URL/.test(error.message),
      `${value} should have been refused`,
    )
  }
})

test('the frontend origin is never accepted as the backend origin', () => {
  assert.throws(
    () => resolveZiniPayWebhookUrl(env({ BASE_URL: FRONTEND })),
    (error: { statusCode?: number; message: string }) =>
      error.statusCode === 503 && /BASE_URL points at the frontend origin/.test(error.message),
    'a callback sent to the frontend only works by accident, so the flow fails closed instead',
  )

  // Unless the owner states the callback url explicitly, which is then used verbatim.
  assert.equal(
    resolveZiniPayWebhookUrl(env({ BASE_URL: FRONTEND, ZINIPAY_WEBHOOK_URL: `${BACKEND}/api/v1/payments/webhook/zinipay` })),
    `${BACKEND}/api/v1/payments/webhook/zinipay`,
  )
})

test('missing or malformed configuration fails safely', () => {
  assert.throws(() => resolveZiniPayWebhookUrl(env({ BASE_URL: undefined })), (error: { statusCode?: number }) => error.statusCode === 503)
  assert.throws(() => resolveZiniPayWebhookUrl(env({ BASE_URL: '' })), (error: { statusCode?: number }) => error.statusCode === 503)
  assert.throws(() => resolveZiniPayWebhookUrl(env({ BASE_URL: 'not a url' })), (error: { statusCode?: number }) => error.statusCode === 503)
  assert.throws(() => resolveZiniPayWebhookUrl(env({ BASE_URL: 'http://sportzonebd-1.onrender.com' })), (error: { statusCode?: number }) => error.statusCode === 503)
  assert.throws(
    () => resolveZiniPayWebhookUrl(env({ BASE_URL: 'https://user:pass@sportzonebd-1.onrender.com' })),
    (error: { statusCode?: number }) => error.statusCode === 503,
  )
  assert.throws(
    () => resolveZiniPayWebhookUrl(env({ ZINIPAY_WEBHOOK_URL: 'not a url' })),
    (error: { statusCode?: number }) => error.statusCode === 503,
  )
})

test('http is only allowed for loopback development hosts', () => {
  assert.equal(parsePublicOrigin('http://localhost:5000', 'BASE_URL')?.origin, 'http://localhost:5000')
  assert.equal(parsePublicOrigin('http://127.0.0.1:5000', 'BASE_URL')?.origin, 'http://127.0.0.1:5000')
  assert.throws(() => parsePublicOrigin('http://api.example.test', 'BASE_URL'), (error: { statusCode?: number }) => error.statusCode === 503)
})

test('the customer URLs come from the frontend origin only', () => {
  const config = resolvePaymentUrlConfig(env())

  assert.equal(config.redirectUrl('payment-1'), `${FRONTEND}/checkout/return?payment=payment-1`)
  assert.equal(config.cancelUrl('plan-1'), `${FRONTEND}/checkout?plan=plan-1&cancel=1`)
  assert.equal(config.webhookUrl, `${BACKEND}/api/v1/payments/webhook/zinipay`)

  // A trailing slash on the frontend origin cannot leak into the paths, and ids are encoded.
  const slashed = resolvePaymentUrlConfig(env({ FRONTEND_URL: `${FRONTEND}/` }))
  assert.equal(slashed.redirectUrl('payment-1'), `${FRONTEND}/checkout/return?payment=payment-1`)
  assert.equal(slashed.cancelUrl('plan 1'), `${FRONTEND}/checkout?plan=plan%201&cancel=1`)
})

test('a frontend origin that is missing or malformed stops the flow before an invoice is created', () => {
  assert.throws(() => resolvePaymentUrlConfig(env({ FRONTEND_URL: undefined })), (error: { statusCode?: number }) => error.statusCode === 503)
  assert.throws(() => resolvePaymentUrlConfig(env({ FRONTEND_URL: 'sport-zone-bd.vercel.app' })), (error: { statusCode?: number }) => error.statusCode === 503)
  assert.throws(() => resolvePaymentUrlConfig(env({ FRONTEND_URL: 'ftp://sport-zone-bd.vercel.app' })), (error: { statusCode?: number }) => error.statusCode === 503)
})
