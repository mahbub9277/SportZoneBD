import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveZiniPayWebhookReference } from './zinipay.webhook.js'

/**
 * What a provider callback is allowed to tell us.
 *
 * The callback is documented without any signature, so it carries exactly one useful fact: which payment the
 * provider is talking about. Its `status` is ignored on purpose — the payment is proven by asking the
 * provider from the server, never by the contents of this request.
 */

test('a JSON body callback is read as documented', () => {
  assert.deepEqual(
    resolveZiniPayWebhookReference({ invoice_id: 'INVOICE_ID', status: 'true', val_id: 'INV-REF-1001' }, {}),
    { invoiceId: 'INVOICE_ID', merchantReference: 'INV-REF-1001' },
  )
})

test('a query-parameter callback is read too', () => {
  assert.deepEqual(
    resolveZiniPayWebhookReference(undefined, { invoice_id: 'INVOICE_ID', status: 'true', val_id: 'INV-REF-1001' }),
    { invoiceId: 'INVOICE_ID', merchantReference: 'INV-REF-1001' },
  )
})

test('either identifier alone is enough, and the merchant reference is recognised', () => {
  assert.deepEqual(resolveZiniPayWebhookReference({ invoice_id: 'INVOICE_ID' }, {}), { invoiceId: 'INVOICE_ID', merchantReference: null })
  assert.deepEqual(resolveZiniPayWebhookReference({}, { val_id: 'SZBD-abc123' }), { invoiceId: null, merchantReference: 'SZBD-abc123' })
  assert.deepEqual(resolveZiniPayWebhookReference({ invoiceId: 'INVOICE_ID' }, {}), { invoiceId: 'INVOICE_ID', merchantReference: null })
})

test('a callback without a usable reference is not a payment claim at all', () => {
  for (const [body, query] of [
    [undefined, {}],
    [{}, {}],
    [{ status: 'true' }, {}],
    [{ invoice_id: '   ' }, {}],
    [{ invoice_id: 12345 }, {}],
    ['not-an-object', {}],
    [[123, 456], {}],
  ] as const) {
    assert.equal(resolveZiniPayWebhookReference(body, query), null, `${JSON.stringify(body)} should not resolve to a payment`)
  }
})

test('an array parameter is not read as a reference, so an attacker cannot queue several payments', () => {
  assert.equal(resolveZiniPayWebhookReference(undefined, { invoice_id: [{ invoice_id: 'INVOICE_ID' }] }), null)
})
