/**
 * Reads the invoice reference out of a ZiniPay hosted-checkout callback.
 *
 * The callback is documented as `{ invoice_id, status, val_id }` sent either as a JSON body or as query
 * parameters, and the provider publishes no signature for it, so nothing here is trusted as evidence: the
 * parsed reference is only used to find the payment, which is then verified server-side. Status values from
 * the callback are deliberately ignored.
 */

const INVOICE_ID_FIELDS = ['invoice_id', 'invoiceId'] as const
const MERCHANT_REFERENCE_FIELDS = ['val_id', 'valId', 'reference'] as const

export interface ZiniPayWebhookReference {
  /** The provider's own invoice id, when the callback carries one. */
  invoiceId: string | null
  /** Our reference for the payment (`val_id`), when the callback carries one. */
  merchantReference: string | null
}

function readString(source: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = source[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function toSource(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    // Express parses `?invoice_id=a&invoice_id=b` into an array; only a scalar reference is meaningful.
    const first = value.find((entry) => typeof entry === 'string')
    return typeof first === 'string' ? { invoice_id: first } : {}
  }
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function resolveZiniPayWebhookReference(
  body: unknown,
  query: unknown,
): ZiniPayWebhookReference | null {
  const sources = [toSource(body), toSource(query)]

  const invoiceId = sources.map((source) => readString(source, INVOICE_ID_FIELDS)).find(Boolean) ?? null
  const merchantReference = sources.map((source) => readString(source, MERCHANT_REFERENCE_FIELDS)).find(Boolean) ?? null

  return invoiceId || merchantReference ? { invoiceId, merchantReference } : null
}
