/** Small shared validators used by every provider adapter so provider JSON is never trusted blindly. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid provider ${field}.`)
  return value
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid provider ${field}.`)
  return value.trim()
}

export function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function nullableHttpUrl(value: unknown): string | null {
  const raw = nullableString(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function providerIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return nullableString(value)
}

/** Parses a provider timestamp and rejects anything that is not a real instant. */
export function requiredUtcIso(value: unknown, field: string): string {
  const raw = requiredString(value, field)
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid provider ${field}.`)
  return parsed.toISOString()
}
