import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ZiniPayCheckoutFailure,
  createZiniPayInvoice,
  getZiniPayPaymentBaseUrl,
  getZiniPayTimeoutMs,
  isZiniPayCheckoutConfigured,
  verifyZiniPayInvoice,
  type ZiniPayHttp,
} from './zinipay.checkout.client.js'

/**
 * The hosted-checkout contract, asserted without a network.
 *
 * These tests are the only place the exact request shape lives, so a wrong header, a wrong field name or a
 * wrongly required field fails here instead of at the provider. The field names and their requiredness come
 * from ZiniPay's documentation plus what its live endpoint actually accepted.
 */

const ENV = { ZINIPAY_API_KEY: 'brand-key-for-tests', ZINIPAY_PAYMENT_BASE_URL: 'https://api.example.test/v1/payment/' } as NodeJS.ProcessEnv

interface RecordedCall {
  url: string
  body: Record<string, unknown>
  headers: Record<string, string>
  timeout: number
}

function fakeHttp(responses: Array<{ status?: number; data?: unknown; throwError?: { code: string; message: string } }>) {
  const calls: RecordedCall[] = []
  let index = 0
  const http: ZiniPayHttp = {
    post: async (url, body, options) => {
      calls.push({ url, body: body as Record<string, unknown>, headers: options.headers, timeout: options.timeout })
      const next = responses[Math.min(index, responses.length - 1)]
      index += 1
      if (next.throwError) throw Object.assign(new Error(next.throwError.message), { code: next.throwError.code })
      return { status: next.status ?? 200, data: next.data ?? {} }
    },
  }
  return { http, calls }
}

const CREATE_PARAMS = {
  amount: 300,
  customerEmail: 'customer@example.com',
  customerName: 'Test Customer',
  merchantReference: 'SZBD-abc123',
  redirectUrl: 'https://app.example.test/checkout/return?payment=payment-1',
  cancelUrl: 'https://app.example.test/checkout?plan=plan-1&cancel=1',
  webhookUrl: 'https://api.example.test/api/v1/payments/webhook/zinipay',
  metadata: { paymentId: 'payment-1', userId: 'user-1', planId: 'plan-1' },
}

test('without an API key the client refuses before any request is made', async () => {
  const { http, calls } = fakeHttp([{}])

  await assert.rejects(
    createZiniPayInvoice(CREATE_PARAMS, { http, env: {} }),
    (error: ZiniPayCheckoutFailure) => error instanceof ZiniPayCheckoutFailure && error.kind === 'not-configured',
  )
  assert.equal(calls.length, 0, 'a missing key must not produce a provider request')
})

test('the invoice request uses the documented endpoint, header and fields', async () => {
  const { http, calls } = fakeHttp([{
    status: 201,
    data: {
      status: true,
      message: 'Invoice created successfully.',
      payment_url: 'https://secure.zinipay.com/payment/INVOICE_ID',
      invoice_id: 'INVOICE_ID',
      invoiceId: 'INVOICE_ID',
      val_id: 'SZBD-abc123',
      environment: 'live',
    },
  }])

  const invoice = await createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.example.test/v1/payment/create')
  assert.equal(calls[0].headers['zini-api-key'], 'brand-key-for-tests')
  assert.equal(calls[0].headers['Content-Type'], 'application/json')
  assert.equal(calls[0].timeout, 20_000)
  assert.deepEqual(calls[0].body, {
    cus_email: 'customer@example.com',
    cus_name: 'Test Customer',
    amount: 300,
    val_id: 'SZBD-abc123',
    redirect_url: CREATE_PARAMS.redirectUrl,
    cancel_url: CREATE_PARAMS.cancelUrl,
    webhook_url: CREATE_PARAMS.webhookUrl,
    metadata: CREATE_PARAMS.metadata,
  })

  // The provider can answer 200 or 201; both mean the invoice exists.
  assert.equal(invoice.invoiceId, 'INVOICE_ID')
  assert.equal(invoice.paymentUrl, 'https://secure.zinipay.com/payment/INVOICE_ID')
  assert.equal(invoice.environment, 'live')
})

test('a cancel url and the customer email are always sent, because the live endpoint requires them', async () => {
  const { http, calls } = fakeHttp([{ status: 201, data: { status: true, payment_url: 'https://secure.zinipay.com/payment/X', invoice_id: 'X' } }])

  await createZiniPayInvoice({ ...CREATE_PARAMS, customerName: null, metadata: undefined }, { http, env: ENV })

  assert.equal('cus_name' in calls[0].body, false, 'an empty name is not sent as an empty string')
  assert.equal('metadata' in calls[0].body, false)
  assert.equal(typeof calls[0].body.cus_email, 'string')
  assert.equal(typeof calls[0].body.cancel_url, 'string')
})

test('an invoice response without a payment url is never accepted', async () => {
  for (const data of [
    { status: true, invoice_id: 'X' },
    { status: true, payment_url: 'https://secure.zinipay.com/payment/X' },
    { status: false, message: 'Only active brands are allowed.' },
  ]) {
    const { http } = fakeHttp([{ status: 201, data }])
    await assert.rejects(
      createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV }),
      (error: ZiniPayCheckoutFailure) => error instanceof ZiniPayCheckoutFailure && (error.kind === 'provider-error' || error.kind === 'invalid-request'),
      `unusable body was accepted: ${JSON.stringify(data)}`,
    )
  }
})

test('provider failures are mapped to the documented kinds', async () => {
  const cases: Array<[number, string]> = [
    [400, 'invalid-request'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'not-found'],
    [500, 'provider-error'],
    [503, 'provider-error'],
  ]

  for (const [status, kind] of cases) {
    const { http } = fakeHttp([{ status, data: { status: false, message: 'nope' } }])
    await assert.rejects(
      verifyZiniPayInvoice({ invoiceId: 'INVOICE_ID' }, { http, env: ENV }),
      (error: ZiniPayCheckoutFailure) => error.kind === kind && error.status === status,
      `HTTP ${status} should map to ${kind}`,
    )
  }

  const timeout = fakeHttp([{ throwError: { code: 'ECONNABORTED', message: 'timeout of 20000ms exceeded' } }])
  await assert.rejects(
    verifyZiniPayInvoice({ invoiceId: 'INVOICE_ID' }, { http: timeout.http, env: ENV }),
    (error: ZiniPayCheckoutFailure) => error.kind === 'timeout' && error.isAmbiguous,
  )

  const network = fakeHttp([{ throwError: { code: 'ECONNRESET', message: 'socket hang up' } }])
  await assert.rejects(
    verifyZiniPayInvoice({ invoiceId: 'INVOICE_ID' }, { http: network.http, env: ENV }),
    (error: ZiniPayCheckoutFailure) => error.kind === 'network' && error.isAmbiguous,
  )
})

test('a validation envelope is reported with the field the provider complained about', async () => {
  const { http } = fakeHttp([{
    status: 400,
    data: { success: false, code: 'VALIDATION_ERROR', message: 'Invalid request data', errors: [{ field: 'body.cancel_url', message: 'Required' }] },
  }])

  try {
    await createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV })
    assert.fail('the call should have failed')
  } catch (error) {
    assert.match((error as Error).message, /body\.cancel_url: Required/)
  }
})

test('the verify request matches the documented payload and reads the invoice state', async () => {
  const { http, calls } = fakeHttp([{
    status: 200,
    data: {
      cus_email: 'customer@example.com',
      amount: 300,
      invoice_id: 'INVOICE_ID',
      invoiceId: 'INVOICE_ID',
      val_id: 'SZBD-abc123',
      metadata: { paymentId: 'payment-1' },
      payment_method: 'bkash',
      provider: 'bkash',
      senderNumber: '017****5678',
      transaction_id: 'TXN123456789',
      status: 'COMPLETED',
    },
  }])

  const check = await verifyZiniPayInvoice({ invoiceId: 'INVOICE_ID' }, { http, env: ENV })

  assert.equal(calls[0].url, 'https://api.example.test/v1/payment/verify')
  assert.deepEqual(calls[0].body, { invoice_id: 'INVOICE_ID' })
  assert.equal(check.status, 'COMPLETED')
  assert.equal(check.amount, 300)
  assert.equal(check.paymentMethod, 'bkash')
  assert.equal(check.transactionId, 'TXN123456789')
  assert.equal(check.merchantReference, 'SZBD-abc123')
  assert.deepEqual(check.metadata, { paymentId: 'payment-1' })
})

test('the statuses only ever map to the documented three, or are refused', async () => {
  for (const [raw, expected] of [['PENDING', 'PENDING'], ['pending', 'PENDING'], ['COMPLETED', 'COMPLETED'], ['FAILED', 'FAILED']] as const) {
    const { http } = fakeHttp([{ status: 200, data: { invoice_id: 'INVOICE_ID', amount: 300, status: raw } }])
    const check = await verifyZiniPayInvoice({ invoiceId: 'INVOICE_ID' }, { http, env: ENV })
    assert.equal(check.status, expected)
  }

  for (const raw of ['CANCELLED', 'REFUNDED', '', 'unknown']) {
    const { http } = fakeHttp([{ status: 200, data: { invoice_id: 'INVOICE_ID', amount: 300, status: raw } }])
    await assert.rejects(
      verifyZiniPayInvoice({ invoiceId: 'INVOICE_ID' }, { http, env: ENV }),
      (error: ZiniPayCheckoutFailure) => error.kind === 'provider-error',
      `${JSON.stringify(raw)} must not be read as a payment state`,
    )
  }
})

test('the hosted payment page host is allow-listed, and nothing else is accepted', async () => {
  const accepted = [
    'https://secure.zinipay.com/payment/INVOICE_ID',
    'https://secure.zinipay.com/testing/payment/test/test_000d0997-9f20-4989-89e9-f941d60876fa',
    'https://secure.zinipay.com/payment/INVOICE_ID?ref=abc',
  ]

  for (const paymentUrl of accepted) {
    const { http } = fakeHttp([{ status: 201, data: { status: true, payment_url: paymentUrl, invoice_id: 'INVOICE_ID' } }])
    const invoice = await createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV })
    assert.equal(invoice.paymentUrl, paymentUrl, `${paymentUrl} should be accepted`)
  }

  const rejected = [
    // Wrong scheme.
    'http://secure.zinipay.com/payment/INVOICE_ID',
    // The API host is an endpoint, never a redirect target.
    'https://api.zinipay.com/payment/INVOICE_ID',
    // Any other host, including lookalikes and other subdomains of the same domain.
    'https://evil.test/payment/INVOICE_ID',
    'https://secure.zinipay.com.evil.test/payment/INVOICE_ID',
    'https://zinipay.com/payment/INVOICE_ID',
    'https://www.zinipay.com/payment/INVOICE_ID',
    'https://secure.zinipay.com@evil.test/payment/INVOICE_ID',
    // Credentials, unexpected ports, malformed values and empty paths.
    'https://user:pass@secure.zinipay.com/payment/INVOICE_ID',
    'https://secure.zinipay.com:8443/payment/INVOICE_ID',
    'not a url',
    'https://secure.zinipay.com/',
    'https://secure.zinipay.com',
  ]

  for (const paymentUrl of rejected) {
    const { http } = fakeHttp([{ status: 201, data: { status: true, payment_url: paymentUrl, invoice_id: 'INVOICE_ID' } }])
    await assert.rejects(
      createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV }),
      (error: ZiniPayCheckoutFailure) => error.kind === 'provider-error',
      `${paymentUrl} should have been refused`,
    )
  }
})

test('a missing payment url is a provider failure, never an empty redirect', async () => {
  const { http } = fakeHttp([{ status: 201, data: { status: true, invoice_id: 'INVOICE_ID' } }])

  await assert.rejects(
    createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV }),
    (error: ZiniPayCheckoutFailure) => error.kind === 'provider-error',
  )
})

test('configuration helpers follow the project environment conventions', () => {
  assert.equal(isZiniPayCheckoutConfigured({} as NodeJS.ProcessEnv), false)
  assert.equal(isZiniPayCheckoutConfigured(ENV), true)
  assert.equal(getZiniPayPaymentBaseUrl({} as NodeJS.ProcessEnv), 'https://api.zinipay.com/v1/payment')
  assert.equal(getZiniPayPaymentBaseUrl(ENV), 'https://api.example.test/v1/payment', 'a trailing slash is trimmed')
  assert.equal(getZiniPayTimeoutMs({ ZINIPAY_TIMEOUT_MS: '3000' } as NodeJS.ProcessEnv), 3000)
  assert.equal(getZiniPayTimeoutMs({} as NodeJS.ProcessEnv), 20_000)
})

test('the API key is never part of a failure that reaches a log or a response', async () => {
  const { http } = fakeHttp([{ status: 401, data: { status: false, message: 'Invalid API key' } }])

  try {
    await createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV })
    assert.fail('the call should have failed')
  } catch (error) {
    const failure = error as ZiniPayCheckoutFailure
    const serialized = JSON.stringify({ message: failure.message, kind: failure.kind, status: failure.status, userMessage: failure.userMessage })
    assert.equal(serialized.includes('brand-key-for-tests'), false, 'the key must never be serialized into an error')
  }
})
