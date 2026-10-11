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

/** A realistic identifier, in the shape the provider's live responses carry. */
const LIVE_INVOICE_ID = 'test_000d0997-9f20-4989-89e9-f941d60876fa'
const LIVE_PAYMENT_URL = `https://secure.zinipay.com/payment/${LIVE_INVOICE_ID}`

test('the invoice request uses the documented endpoint, header and fields', async () => {
  const { http, calls } = fakeHttp([{
    status: 201,
    data: {
      status: true,
      message: 'Invoice created successfully.',
      payment_url: LIVE_PAYMENT_URL,
      invoice_id: LIVE_INVOICE_ID,
      invoiceId: LIVE_INVOICE_ID,
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
  assert.equal(invoice.invoiceId, LIVE_INVOICE_ID)
  assert.equal(invoice.paymentUrl, LIVE_PAYMENT_URL)
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
    LIVE_PAYMENT_URL,
    `https://secure.zinipay.com/testing/payment/test/${LIVE_INVOICE_ID}`,
    `${LIVE_PAYMENT_URL}?ref=abc`,
  ]

  for (const paymentUrl of accepted) {
    const { http } = fakeHttp([{ status: 201, data: { status: true, payment_url: paymentUrl, invoice_id: LIVE_INVOICE_ID } }])
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
    const { http } = fakeHttp([{ status: 201, data: { status: true, payment_url: paymentUrl, invoice_id: 'a-real-id' } }])
    await assert.rejects(
      createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV }),
      (error: ZiniPayCheckoutFailure) => error.kind === 'provider-error',
      `${paymentUrl} should have been refused`,
    )
  }
})

test('the documented minimal response — no invoice id field — is accepted, with the id read from the payment url', async () => {
  // ZiniPay's official Postman collection documents exactly this body for a successful create, and its own
  // test script reads the invoice id out of the payment url. Production returned this shape, which is what
  // produced "invoice response is missing the invoice id" before the fix.
  const { http } = fakeHttp([{
    status: 200,
    data: {
      status: true,
      message: 'Invoice created successfully.',
      payment_url: LIVE_PAYMENT_URL,
    },
  }])

  const invoice = await createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV })

  assert.equal(invoice.invoiceId, LIVE_INVOICE_ID)
  assert.equal(invoice.paymentUrl, LIVE_PAYMENT_URL)
  assert.equal(invoice.environment, null)
})

test('a documented id field wins over the url, and the sandbox path shape is read correctly', async () => {
  const fromField = fakeHttp([{
    status: 201,
    data: { status: true, payment_url: 'https://secure.zinipay.com/payment/url-segment-id', invoice_id: 'response-field-id' },
  }])
  assert.equal((await createZiniPayInvoice(CREATE_PARAMS, { http: fromField.http, env: ENV })).invoiceId, 'response-field-id')

  const camelCase = fakeHttp([{
    status: 201,
    data: { status: true, payment_url: 'https://secure.zinipay.com/payment/url-segment-id', invoiceId: 'camel-case-id' },
  }])
  assert.equal((await createZiniPayInvoice(CREATE_PARAMS, { http: camelCase.http, env: ENV })).invoiceId, 'camel-case-id')

  // The sandbox nests the id behind a `test` segment; the identifier is the last segment, not the first.
  const sandbox = fakeHttp([{ status: 201, data: { status: true, payment_url: `https://secure.zinipay.com/testing/payment/test/${LIVE_INVOICE_ID}` } }])
  assert.equal((await createZiniPayInvoice(CREATE_PARAMS, { http: sandbox.http, env: ENV })).invoiceId, LIVE_INVOICE_ID)
})

test('the documentation placeholder is never stored as an invoice id', async () => {
  // `INVOICE_ID` is what ZiniPay's published examples use in place of a real identifier. Accepting it would
  // send a customer to a page that cannot be paid and could never be verified.
  const { http } = fakeHttp([{ status: 201, data: { status: true, payment_url: 'https://secure.zinipay.com/payment/INVOICE_ID' } }])

  await assert.rejects(
    createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV }),
    (error: ZiniPayCheckoutFailure) => error.kind === 'provider-error' && /no usable invoice id/.test(error.message),
  )

  const inField = fakeHttp([{ status: 201, data: { status: true, payment_url: LIVE_PAYMENT_URL, invoice_id: 'INVOICE_ID' } }])
  await assert.rejects(
    createZiniPayInvoice(CREATE_PARAMS, { http: inField.http, env: ENV }),
    (error: ZiniPayCheckoutFailure) => error.kind === 'provider-error',
  )
})

test('an unusable payment path yields no invoice id instead of an invented one', async () => {
  for (const paymentUrl of [
    // No `payment` segment at all.
    'https://secure.zinipay.com/invoices/abc123',
    // A path that ends at the controller rather than at an identifier.
    'https://secure.zinipay.com/payment',
    'https://secure.zinipay.com/payment/',
    // Markup, traversal and absurdly long values are not identifiers.
    'https://secure.zinipay.com/payment/%3Cscript%3E',
    'https://secure.zinipay.com/payment/..',
    `https://secure.zinipay.com/payment/${'a'.repeat(120)}`,
  ]) {
    const { http } = fakeHttp([{ status: 201, data: { status: true, payment_url: paymentUrl } }])
    await assert.rejects(
      createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV }),
      (error: ZiniPayCheckoutFailure) => error.kind === 'provider-error',
      `${paymentUrl} should not produce an invoice id`,
    )
  }
})

test('a failed create reports the response shape it saw, without any values', async () => {
  const usable = fakeHttp([{
    status: 200,
    data: {
      status: true,
      message: 'Invoice created successfully.',
      payment_url: 'https://secure.zinipay.com/payment/some-real-looking-id',
      extra_unknown_field: 'sensitive-looking-value',
    },
  }])

  // No usable path id, and an unexpected extra field the provider may have added: the field list is what
  // makes the real production shape diagnosable.
  const noId = fakeHttp([{
    status: 200,
    data: { status: true, payment_url: 'https://secure.zinipay.com/payment', invoice_ref: 'something-else' },
  }])

  assert.equal((await createZiniPayInvoice(CREATE_PARAMS, { http: usable.http, env: ENV })).invoiceId, 'some-real-looking-id')

  try {
    await createZiniPayInvoice(CREATE_PARAMS, { http: noId.http, env: ENV })
    assert.fail('the call should have failed')
  } catch (error) {
    const failure = error as ZiniPayCheckoutFailure
    const diagnostics = failure.diagnostics
    assert.ok(diagnostics, 'a failure must carry diagnostics')
    assert.deepEqual(diagnostics.fields, ['status', 'payment_url', 'invoice_ref'], 'only field names are captured')
    assert.equal(diagnostics.hasPaymentUrl, true)
    assert.equal(diagnostics.hasInvoiceId, false)
    assert.equal(diagnostics.providerSuccess, true)
    // The shape of the page that could not be read is recorded, but never the page itself.
    assert.equal(diagnostics.paymentUrlHost, 'secure.zinipay.com')
    assert.equal(diagnostics.paymentUrlPathSegments, 1)
    assert.match(failure.message, /fields: status,payment_url,invoice_ref/)
    assert.match(failure.message, /host=secure\.zinipay\.com/)
    assert.match(failure.message, /segments=1/)
    assert.doesNotMatch(failure.message, /secure\.zinipay\.com\/payment/)

    // Nothing that could identify a customer or a payment may appear in what gets logged.
    const serialized = JSON.stringify({ message: failure.message, diagnostics })
    assert.equal(serialized.includes('sensitive-looking-value'), false, 'values must never be captured')
    assert.equal(serialized.includes('something-else'), false, 'values must never be captured')
    assert.equal(serialized.includes('brand-key-for-tests'), false, 'the API key must never be captured')
  }
})

test('a provider refusal is classified and carries no values', async () => {
  const { http } = fakeHttp([{
    status: 401,
    data: { status: false, message: 'Invalid API key', api_key: 'leaked-value' },
  }])

  try {
    await createZiniPayInvoice(CREATE_PARAMS, { http, env: ENV })
    assert.fail('the call should have failed')
  } catch (error) {
    const failure = error as ZiniPayCheckoutFailure
    assert.equal(failure.kind, 'unauthorized')
    assert.equal(failure.status, 401)
    assert.match(String(failure.diagnostics?.fields), /status,message,api_key/)
    assert.equal(JSON.stringify(failure.diagnostics).includes('leaked-value'), false)
  }
})

test('a missing payment url is a provider failure, never an empty redirect', async () => {
  const { http } = fakeHttp([{ status: 201, data: { status: true, invoice_id: LIVE_INVOICE_ID } }])

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
