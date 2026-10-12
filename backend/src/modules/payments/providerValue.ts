/**
 * How provider values are read.
 *
 * ZiniPay answers with placeholder strings for values it does not have — its live invoice verification returns
 * `transaction_id: "N/A"` and `provider: "unknown"` for an invoice nobody has paid yet. Those are the absence
 * of a fact, not a fact: storing them would record a transaction reference that does not exist, and comparing
 * them against a payment's reference would refuse a legitimate payment. Everything read from the provider goes
 * through here, so a placeholder can never be mistaken for data.
 */

/** Text the provider uses to mean "nothing". Compared case-insensitively after trimming. */
const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'nil',
  'none',
  'null',
  'undefined',
  'unknown',
  'not available',
  'not provided',
  'not applicable',
])

/** A trimmed string, or null when there was nothing to trim. Numbers are accepted as their text form. */
export function toTrimmedString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** Like `toTrimmedString`, but the provider's placeholders are reported as missing instead of as values. */
export function toMeaningfulString(value: unknown): string | null {
  const raw = toTrimmedString(value)
  if (!raw) return null
  return PLACEHOLDER_VALUES.has(raw.toLowerCase()) ? null : raw
}

/** A finite number from a number or a numeric string; anything else (including placeholders) is missing. */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * Keeps a person's phone number recognisable without storing it in full: the first three digits and the last
 * four are enough for an operator to match it against a payment, and not enough to reuse it.
 */
export function maskPhoneNumber(value: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/[^\d]/g, '')
  if (digits.length < 7) return null
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`
}

/** Amounts are compared at two decimal places, because that is the precision the provider and we both store. */
export function amountsMatch(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return false
  return Math.round(left * 100) === Math.round(right * 100)
}
