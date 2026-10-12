import assert from 'node:assert/strict'
import { test } from 'node:test'

const {
  ZiniPayTrxFailure,
  verifyZiniPayTransaction,
  confirmZiniPayTransaction,
  isTrxVerificationEnabled,
  isTrxVerificationConfigured,
  TRX_VERIFICATION_FLAG,
} = await import('./zinipay.trx.client.js')

/**
 * The transaction-verification client is the only place a customer's transaction reference reaches the provider,
 * and the only place the provider's answer becomes a fact we act on. What is asserted here is therefore:
 *
 * - the documented request shape (endpoint, header, body) and nothing invented;
 * - every documented refusal is classified distinctly, with an amount mismatch and an already-used transaction
 *   never looking like a success;
 * - an answer that is a 2xx but not a verification (a refusal envelope, a missing id, a placeholder reference,
 *   a non-`UNUSED` state) is refused rather than trusted;
 * - masked data stays masked, and the API key never appears anywhere it could be logged or shown.
 */

const ENABLED_ENV = {
  ZINIPAY_API_KEY: 'brand-key-for-tests',
  ZINIPAY_TRX_VERIFICATION_ENABLED: 'true',
} as NodeJS.ProcessEnv

interface RecordedCall {
  url: string
  body: unknown
  headers: Record<string, string>
  timeout: number
}

function fakeHttp(replies: Array<{ status: number; data: unknown } | Error>) {
  const calls: RecordedCall[] = []
  let index = 0
  const http = {
    post: async (url: string, body: unknown, options: { headers: Record<string, string>; timeout: number }) => {
      calls.push({ url, body, headers: options.headers, timeout: options.timeout })
      const reply = replies[Math.min(index, replies.length - 1)]
      index += 1
      if (reply instanceof Error) throw reply
      return reply
    },
  }
  return { calls, http }
}

type TrxFailure = InstanceType<typeof ZiniPayTrxFailure>

const successEnvelope = (data: Record<string, unknown>) => ({ status: 200, data: { statusCode: 200, success: true, message: 'ok', data } })

const VERIFY_DATA = {
  id: 1234,
  trxID: 'TXN123456789',
  smsRef: 'ORDER-1001',
  amount: 10,
  sender: '017****5678',
  status: 'UNUSED',
  provider: 'bKash',
  timestamp: '2026-05-20T10:30:00.000Z',
}

test('verification is off unless the deployment switches it on', async () => {
  assert.equal(isTrxVerificationEnabled({} as NodeJS.ProcessEnv), false)
  assert.equal(isTrxVerificationConfigured({} as NodeJS.ProcessEnv), false)
  assert.equal(isTrxVerificationEnabled({ [TRX_VERIFICATION_FLAG]: 'TRUE' } as NodeJS.ProcessEnv), true)
  assert.equal(isTrxVerificationConfigured({ [TRX_VERIFICATION_FLAG]: 'true' } as NodeJS.ProcessEnv), false, 'a flag without a key is not usable')

  const { calls, http } = fakeHttp([successEnvelope(VERIFY_DATA)])
  await assert.rejects(
    verifyZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10 }, { env: {} as NodeJS.ProcessEnv, http }),
    (error: { kind?: string }) => error?.kind === 'not-enabled',
  )
  assert.equal(calls.length, 0, 'a switched-off capability must never reach the provider')
})

test('a missing key is reported as configuration, not as a provider failure', async () => {
  const { calls, http } = fakeHttp([])
  await assert.rejects(
    verifyZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10 }, { env: { [TRX_VERIFICATION_FLAG]: 'true' } as NodeJS.ProcessEnv, http }),
    (error: { kind?: string }) => error?.kind === 'not-configured',
  )
  assert.equal(calls.length, 0)
})

test('the documented verify request and answer produce a usable verification', async () => {
  const { calls, http } = fakeHttp([successEnvelope(VERIFY_DATA)])

  const result = await verifyZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10 }, { env: ENABLED_ENV, http })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.zinipay.com/v1/trx/verify')
  assert.deepEqual(calls[0].body, { transactionId: 'TXN123456789', amount: 10 })
  assert.equal(calls[0].headers['zinipay-api-key'], 'brand-key-for-tests')
  assert.equal(calls[0].headers['zini-api-key'], undefined, 'the transaction API documents its own header')

  assert.deepEqual(result, {
    id: 1234,
    transactionId: 'TXN123456789',
    amount: 10,
    senderMasked: '017****5678',
    provider: 'bKash',
    status: 'UNUSED',
    timestamp: '2026-05-20T10:30:00.000Z',
  })
})

test('the documented confirm request consumes exactly the verified transaction', async () => {
  const { calls, http } = fakeHttp([successEnvelope({
    id: 1234,
    provider: 'bKash',
    message: 'Payment received...',
    transactionId: 'TXN123456789',
    senderNumber: '01712345678',
    amount: 10,
    timestamp: '2026-05-20T10:30:00.000Z',
    status: false,
  })])

  const result = await confirmZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10, id: 1234 }, { env: ENABLED_ENV, http })

  assert.equal(calls[0].url, 'https://api.zinipay.com/v1/trx/confirm')
  assert.deepEqual(calls[0].body, { transactionId: 'TXN123456789', amount: 10, id: 1234 })
  // The confirm answer carries the full sender number; only the masked form may leave this function.
  assert.equal(result.senderMasked, '017****5678')
  assert.equal(JSON.stringify(result).includes('01712345678'), false, 'the unmasked sender must never be returned')
})

test('every documented refusal is classified distinctly', async () => {
  const cases: Array<{ name: string; reply: { status: number; data: unknown }; kind: string }> = [
    { name: 'feature disabled', reply: { status: 403, data: { statusCode: 403, success: false, message: 'Transaction verification API is not enabled for your service. Please enable it from the dashboard.', code: 'FEATURE_DISABLED' } }, kind: 'feature-disabled' },
    { name: 'insufficient credits', reply: { status: 402, data: { statusCode: 402, success: false, message: 'Insufficient credits for transaction verification', code: 'INSUFFICIENT_CREDITS' } }, kind: 'no-credits' },
    { name: 'expired credits', reply: { status: 402, data: { statusCode: 402, success: false, message: 'Credits have expired', code: 'CREDITS_EXPIRED' } }, kind: 'no-credits' },
    { name: 'already used', reply: { status: 400, data: { statusCode: 400, success: false, message: 'Transaction is already used' } }, kind: 'already-used' },
    { name: 'amount mismatch', reply: { status: 400, data: { statusCode: 400, success: false, message: 'Transaction amount must be equal to the provided amount' } }, kind: 'amount-mismatch' },
    { name: 'not found', reply: { status: 404, data: { statusCode: 404, success: false, message: 'Transaction not found' } }, kind: 'not-found' },
    { name: 'server error', reply: { status: 500, data: { statusCode: 500, success: false, message: 'Internal Server Error' } }, kind: 'provider-error' },
  ]

  for (const scenario of cases) {
    const { http } = fakeHttp([scenario.reply])
    await assert.rejects(
      verifyZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10 }, { env: ENABLED_ENV, http }),
      (error: TrxFailure) => {
        assert.equal(error.kind, scenario.kind, `${scenario.name} was classified as ${error.kind}`)
        assert.equal(error.message.includes('brand-key-for-tests'), false, 'the key must never reach a message')
        assert.ok(error.userMessage.length > 0)
        return true
      },
    )
  }
})

test('the device-offline refusal is its own kind, because it needs a different fix', async () => {
  const { http } = fakeHttp([{ status: 403, data: { statusCode: 403, success: false, message: 'Device is not connected with the service' } }])

  await assert.rejects(
    confirmZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10, id: 1234 }, { env: ENABLED_ENV, http }),
    (error: TrxFailure) => error.kind === 'device-offline',
  )
})

test('a 2xx that is not a verification is never treated as one', async () => {
  const cases: Array<{ name: string; reply: { status: number; data: unknown }; kind: string }> = [
    { name: 'refusal envelope with 200', reply: { status: 200, data: { statusCode: 200, success: false, message: 'Transaction is already used' } }, kind: 'already-used' },
    { name: 'no data object', reply: { status: 200, data: { statusCode: 200, success: true, message: 'ok' } }, kind: 'malformed' },
    { name: 'no transaction id', reply: successEnvelope({ ...VERIFY_DATA, id: 'N/A' }), kind: 'malformed' },
    { name: 'no status', reply: successEnvelope({ ...VERIFY_DATA, status: 'N/A' }), kind: 'malformed' },
    { name: 'no amount', reply: successEnvelope({ ...VERIFY_DATA, amount: null }), kind: 'malformed' },
    { name: 'no reference', reply: successEnvelope({ ...VERIFY_DATA, trxID: undefined, transactionId: undefined }), kind: 'malformed' },
    { name: 'transaction already consumed provider-side', reply: successEnvelope({ ...VERIFY_DATA, status: 'USED' }), kind: 'already-used' },
    { name: 'not an object', reply: { status: 200, data: 'ok' }, kind: 'malformed' },
  ]

  for (const scenario of cases) {
    const { http } = fakeHttp([scenario.reply])
    await assert.rejects(
      verifyZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10 }, { env: ENABLED_ENV, http }),
      (error: { kind?: string }) => error?.kind === scenario.kind,
      `${scenario.name} was not refused as ${scenario.kind}`,
    )
  }
})

test('the provider placeholders are read as absent, not as data', async () => {
  const { http } = fakeHttp([successEnvelope({
    id: 1234,
    trxID: 'TXN123456789',
    amount: 10,
    sender: 'N/A',
    status: 'UNUSED',
    provider: 'unknown',
    timestamp: 'N/A',
  })])

  const result = await verifyZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10 }, { env: ENABLED_ENV, http })

  assert.equal(result.senderMasked, null)
  assert.equal(result.provider, null)
  assert.equal(result.timestamp, null)
  assert.equal(result.transactionId, 'TXN123456789')
})

test('network failures and timeouts stay distinguishable and cost nothing', async () => {
  const timeout = Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' })
  const { http: timeoutHttp } = fakeHttp([timeout])
  await assert.rejects(
    verifyZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10 }, { env: ENABLED_ENV, http: timeoutHttp }),
    (error: TrxFailure) => error.kind === 'timeout' && error.isAmbiguous === true,
  )

  const { http: networkHttp } = fakeHttp([Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })])
  await assert.rejects(
    verifyZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10 }, { env: ENABLED_ENV, http: networkHttp }),
    (error: TrxFailure) => error.kind === 'network' && error.isAmbiguous === true,
  )
})

test('the request never carries anything but the documented fields', async () => {
  const { calls, http } = fakeHttp([successEnvelope(VERIFY_DATA)])
  await verifyZiniPayTransaction({ transactionId: 'TXN123456789', amount: 10.5 }, { env: ENABLED_ENV, http })

  assert.deepEqual(Object.keys(calls[0].body as Record<string, unknown>).sort(), ['amount', 'transactionId'])
  assert.equal(calls[0].timeout > 0, true)
})
