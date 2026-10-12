/**
 * Masking for payment references that leave the database.
 *
 * A payment reference is the customer's own payment data. Stored rows keep the full value so a payment can be
 * reconciled, but anything written to a log, a response body or an audit event carries only the tail, so an
 * operator can recognise a reference without it being reproduced in full.
 */
export const maskReference = (value: string): string =>
  value.length <= 4 ? '****' : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`
