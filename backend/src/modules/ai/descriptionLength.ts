/**
 * The character rule for generated descriptions.
 *
 * "As long as it looks about right" is not a rule: whether a description is 79 or 81 characters has to
 * come from one counting method that both the generator and its validation use, and the same method has
 * to be reproducible in a test. The rule is:
 *
 * 1. Remove markup, entities and any surrounding quotes — the description is the text a reader sees.
 * 2. Collapse runs of whitespace and trim the ends.
 * 3. Count Unicode code points, not UTF-16 units, so a Bangla character counts as one.
 */

export interface DescriptionLengthRange {
  min: number
  max: number
}

export interface DescriptionLengthCheck {
  text: string
  length: number
  inRange: boolean
  /** Why the text does not fit, so a caller can decide between rewriting and refusing. */
  reason: 'ok' | 'too-short' | 'too-long'
}

/** Same shape as the entity description fields: plain text, never markup. */
export function normalizeDescriptionText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/^[\s'"“”‘’]+|[\s'"“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The one counting method: Unicode code points of the normalised text. */
export function countDescriptionCharacters(value: string): number {
  return Array.from(normalizeDescriptionText(value)).length
}

export function checkDescriptionLength(value: string, range: DescriptionLengthRange): DescriptionLengthCheck {
  const text = normalizeDescriptionText(value)
  const length = Array.from(text).length
  if (length < range.min) return { text, length, inRange: false, reason: 'too-short' }
  if (length > range.max) return { text, length, inRange: false, reason: 'too-long' }
  return { text, length, inRange: true, reason: 'ok' }
}

/**
 * The last sentence boundary at or before `limit` code points, or null when there is none.
 *
 * Whole sentences only: dropping a trailing sentence keeps the meaning of everything that remains,
 * while cutting mid-sentence leaves a claim hanging and is never done here.
 */
export function lastSentenceBoundaryWithin(text: string, limit: number): number | null {
  const points = Array.from(text)
  let boundary: number | null = null
  for (let index = 0; index < points.length && index < limit; index += 1) {
    if (/[.!?।]/.test(points[index]) && (index + 1 === points.length || points[index + 1] === ' ')) {
      boundary = index + 1
    }
  }
  return boundary
}

/**
 * The only shortening this module performs: drop trailing whole sentences while the remaining text
 * still satisfies the minimum. It never cuts inside a word or a sentence and never adds wording, so a
 * description that comes back from here always says exactly what the model said — just less of it.
 *
 * Text that is too short is returned untouched with `inRange: false`: padding it with filler to reach a
 * character count would make the description false, so the caller has to ask for a rewrite instead.
 */
export function fitDescriptionToLengthRange(value: string, range: DescriptionLengthRange): DescriptionLengthCheck {
  const check = checkDescriptionLength(value, range)
  if (check.inRange || check.reason === 'too-short') return check

  let remaining = check.text
  while (Array.from(remaining).length > range.max) {
    const boundary = lastSentenceBoundaryWithin(remaining, range.max + 1)
    if (boundary === null) break
    const candidate = normalizeDescriptionText(Array.from(remaining).slice(0, boundary).join(''))
    if (Array.from(candidate).length < range.min) break
    remaining = candidate
  }

  return checkDescriptionLength(remaining, range)
}
