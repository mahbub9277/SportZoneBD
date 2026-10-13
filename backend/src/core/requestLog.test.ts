import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Writable } from 'node:stream'
import pino from 'pino'

const { LOG_REDACT } = await import('./logger.js')
const { pathOnly, REQUEST_LOG_SERIALIZERS, requestLogSerializer, requestLogSummary, responseLogSerializer, safeRequestHeaders } = await import('./requestLog.js')

/**
 * What a log line may contain.
 *
 * A production log line leaked the `zinipay-api-key` request header and the provider callback URL with its
 * query string, which carries a customer email, a sender number, a transaction reference and payment
 * identifiers. These tests assert the two halves of the fix:
 *
 * 1. the logger redacts provider credentials in every shape they are realistically logged in — the request
 *    header, an axios error's `config.headers`, a query parameter;
 * 2. the request/response serializers are an allowlist: the path without its query string, the request id, the
 *    client address, a few non-identifying headers and the status code, and nothing else.
 *
 * The secret values used here are invented for the test and never printed on failure: assertions compare
 * against the censor marker or check for absence.
 */

const SECRET = 'brand-key-that-must-never-be-logged'

function captureLogger() {
  const lines: string[] = []
  const sink = new Writable({
    write(chunk: unknown, _encoding: unknown, callback: () => void) {
      lines.push(String(chunk))
      callback()
    },
  })

  return { logger: pino({ level: 'info', redact: LOG_REDACT }, sink), lines }
}

test('a provider API key in a request header is redacted in every casing', () => {
  const { logger, lines } = captureLogger()

  logger.info({ req: { headers: { 'zinipay-api-key': SECRET, 'user-agent': 'curl/8' } } }, 'incoming')
  logger.info({ req: { headers: { 'zini-api-key': SECRET } } }, 'incoming')
  logger.info({ req: { headers: { 'Zinipay-Api-Key': SECRET } } }, 'incoming')
  logger.info({ req: { headers: { authorization: `Bearer ${SECRET}` } } }, 'incoming')
  logger.info({ req: { headers: { cookie: `refreshToken=${SECRET}` } } }, 'incoming')
  logger.info({ req: { headers: { 'x-auth-token': SECRET, 'X-Auth-Token': SECRET } } }, 'incoming')

  const output = lines.join('\n')
  assert.equal(output.includes(SECRET), false, 'a credential value reached the log')
  assert.match(output, /\[REDACTED\]/)
  // The useful part of the same line survives.
  assert.match(output, /curl\/8/)
})

test('a credential inside a logged axios error is redacted too', () => {
  const { logger, lines } = captureLogger()

  // The exact shape axios leaves behind: own enumerable `config`/`response` on an Error instance, logged both
  // under `error` (no pino serializer) and under `err` (pino's own serializer).
  const axiosError = Object.assign(new Error('Request failed with status code 401'), {
    isAxiosError: true,
    code: 'ERR_BAD_REQUEST',
    config: { url: 'https://api.zinipay.com/v1/payment/create', headers: { 'zini-api-key': SECRET, 'Content-Type': 'application/json' } },
    response: { status: 401, data: { status: false, message: 'Unauthorized' }, headers: { 'content-type': 'application/json' } },
  })

  logger.error({ error: axiosError }, 'provider call failed')
  logger.error({ err: axiosError }, 'provider call failed')
  logger.error({ context: { request: { config: { headers: { 'zinipay-api-key': SECRET, 'X-Auth-Token': SECRET } } } } }, 'provider call failed')

  const output = lines.join('\n')
  assert.equal(output.includes(SECRET), false, 'a credential value reached the log')
  // Diagnostics that help without exposing anything stay in the line.
  assert.match(output, /v1\/payment\/create/)
  assert.match(output, /401/)
  assert.match(output, /ERR_BAD_REQUEST/)
})

test('a credential sent as a query parameter is redacted', () => {
  const { logger, lines } = captureLogger()

  logger.warn({ req: { query: { apikey: SECRET, invoice_id: 'INVOICE-1' } } }, 'callback')

  const output = lines.join('\n')
  assert.equal(output.includes(SECRET), false, 'a credential value reached the log')
  assert.match(output, /INVOICE-1/)
})

test('ordinary operational fields are untouched by the redaction', () => {
  const { logger, lines } = captureLogger()

  logger.info({ paymentId: 'payment-1', status: 'PENDING', amount: 10, kind: 'provider-error' }, 'ZiniPay invoice could not be checked')

  const output = lines.join('\n')
  assert.match(output, /payment-1/)
  assert.match(output, /provider-error/)
  assert.equal(output.includes('[REDACTED]'), false, 'redaction changed a line that held no secret')
})

test('a request log line carries the path, never the query string or the credentials', () => {
  const line = requestLogSerializer({
    id: 'req-1',
    method: 'GET',
    originalUrl: '/api/v1/payments/webhook/zinipay?invoice_id=INVOICE-1&status=true&val_id=SZBD-1&email=customer%40example.com&sender=01712345678&transaction_id=TXN1',
    headers: {
      'zinipay-api-key': SECRET,
      authorization: `Bearer ${SECRET}`,
      cookie: `accessToken=${SECRET}`,
      'x-bkcs-signature': SECRET,
      'user-agent': 'ZiniPay/1.0',
      'content-type': 'application/json',
      accept: '*/*',
    },
    socket: { remoteAddress: '203.0.113.7' },
  })

  const serialized = JSON.stringify(line)

  assert.equal(line.url, '/api/v1/payments/webhook/zinipay')
  assert.equal(serialized.includes('?'), false, 'a query string survived into the log line')
  for (const sensitive of ['INVOICE-1', 'SZBD-1', 'customer%40example.com', '01712345678', 'TXN1', SECRET, 'Bearer', 'accessToken']) {
    assert.equal(serialized.includes(sensitive), false, `${sensitive} survived into the log line`)
  }

  // Still useful for operations: which request, from where, and what it claimed to be.
  assert.equal(line.method, 'GET')
  assert.equal(line.id, 'req-1')
  assert.equal(line.remoteAddress, '203.0.113.7')
  assert.deepEqual(line.headers, { 'user-agent': 'ZiniPay/1.0', 'content-type': 'application/json', accept: '*/*' })
})

test('path parameters and the parsed query object are not logged at all', () => {
  const line = requestLogSerializer({
    method: 'POST',
    originalUrl: '/api/v1/payments/checkout/payment-1/verify',
    headers: {},
    params: { paymentId: 'payment-1' },
    query: { token: SECRET },
  })

  assert.equal(line.url, '/api/v1/payments/checkout/payment-1/verify')
  // The path itself is logged (that is what makes the line useful); the parsed `params` and `query` objects,
  // which is where a token or a payment reference would otherwise appear twice, are not.
  assert.equal('params' in line, false)
  assert.equal('query' in line, false)
  assert.equal(JSON.stringify(line).includes(SECRET), false)
})

test('a response log line carries the status code and no headers', () => {
  const line = responseLogSerializer({ statusCode: 200 })

  assert.deepEqual(line, { statusCode: 200 })
  assert.equal(JSON.stringify(line).includes('set-cookie'), false, 'a Set-Cookie header would be a session leak')
})

test('only the allow-listed headers are ever kept, and only their first value', () => {
  assert.deepEqual(
    safeRequestHeaders({ 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '203.0.113.7', referer: 'https://app.example.test/checkout/return?payment=payment-1' }),
    { 'user-agent': 'Mozilla/5.0' },
  )
  assert.deepEqual(safeRequestHeaders({ 'user-agent': ['first', 'second'] }), { 'user-agent': 'first' })
  assert.deepEqual(safeRequestHeaders(undefined), {})
  assert.deepEqual(safeRequestHeaders({ 'user-agent': '' }), {})
})

test('the HTTP logger records a provider callback without its query string or credentials', async () => {
  const express = (await import('express')).default
  const { pinoHttp } = await import('pino-http')
  const { STATUS_CODES } = await import('node:http')

  const { logger, lines } = captureLogger()
  const app = express()

  app.use(pinoHttp({
    logger,
    serializers: REQUEST_LOG_SERIALIZERS,
    customSuccessMessage: (req: { method?: string; url?: string }, res: { statusCode: number }) =>
      requestLogSummary(req.method, req.url, res.statusCode, STATUS_CODES[res.statusCode] ?? 'unknown'),
    customErrorMessage: (req: { method?: string; url?: string }, res: { statusCode: number }, err: Error) =>
      requestLogSummary(req.method, req.url, res.statusCode, STATUS_CODES[res.statusCode] ?? 'unknown', err.message),
  } as never))

  // The callback route shape this app actually serves, answering the way it does.
  app.get('/api/v1/payments/webhook/zinipay', (_req, res) => {
    res.status(200).json({ success: true, message: 'Checked: COMPLETED.' })
  })

  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/payments/webhook/zinipay?invoice_id=INVOICE-1&status=true&val_id=SZBD-1&email=customer%40example.com&sender=01712345678&transaction_id=TXN1`,
      { headers: { 'zinipay-api-key': SECRET, 'user-agent': 'ZiniPay/1.0' } },
    )
    assert.equal(response.status, 200)

    // Give pino-http's finish hook a moment to write, then assert on what was actually recorded.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const output = lines.join('\n')

    assert.ok(output.length > 0, 'the request was not logged at all')
    assert.match(output, /api\/v1\/payments\/webhook\/zinipay/)
    assert.match(output, /200/)
    for (const sensitive of [SECRET, 'customer%40example.com', '01712345678', 'TXN1', 'INVOICE-1', 'SZBD-1']) {
      assert.equal(output.includes(sensitive), false, `${sensitive} was recorded in the request log`)
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('pathOnly strips the query string and the fragment, and leaves plain paths alone', () => {
  assert.equal(pathOnly('/api/v1/payments/webhook/zinipay?invoice_id=1&status=true'), '/api/v1/payments/webhook/zinipay')
  assert.equal(pathOnly('/api/v1/payments/history'), '/api/v1/payments/history')
  assert.equal(pathOnly('https://api.example.test/health?x=1#frag'), 'https://api.example.test/health')
  assert.equal(pathOnly('/checkout#step-2'), '/checkout')
  assert.equal(pathOnly('?invoice_id=1'), undefined, 'a query with no path still yields no path')
  assert.equal(pathOnly(''), undefined)
  assert.equal(pathOnly(undefined), undefined)
})
