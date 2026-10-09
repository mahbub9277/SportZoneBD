/**
 * The client half of the description length rule.
 *
 * It is deliberately the same method the server uses (`modules/ai/descriptionLength.ts`): strip markup
 * and surrounding quotes, collapse whitespace, then count Unicode code points. Keeping a copy here lets
 * the admin form reject a result before it is inserted, while the server stays authoritative — a
 * description that passes here and fails there would be a bug in one of the two, which is exactly what
 * the shared test fixtures are for.
 */

export interface DescriptionLengthRange {
  min: number
  max: number
}

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

export function countDescriptionCharacters(value: string): number {
  return Array.from(normalizeDescriptionText(value)).length
}

export function isDescriptionWithinRange(value: string, range: DescriptionLengthRange): boolean {
  const length = countDescriptionCharacters(value)
  return length >= range.min && length <= range.max
}
