/**
 * Cricket eligibility tiers used by automatic discovery.
 *
 * CricketData exposes no importance/level field, so the smallest deterministic rule set is derived
 * from fields the provider actually returns: `matchType` (e.g. "t20", "odi", "test") and the
 * tournament identity (`series`).
 *
 * A -> long-format tiers (test, odi)            -> always eligible for review
 * B -> the main short format (t20)              -> always eligible for review
 * C -> other recognized short formats           -> eligible only for a recognized marquee series
 * D -> unknown/missing format, or other formats -> never imported automatically
 *
 * A missing or unknown `matchType` maps to D on purpose: the system never guesses eligibility, and
 * nothing is fabricated when the provider does not classify the fixture.
 */
export type CricketCategory = 'A' | 'B' | 'C' | 'D'

const CATEGORY_A_FORMATS = new Set(['test', 'odi'])
const CATEGORY_B_FORMATS = new Set(['t20', 't20i', 'it20'])
const CATEGORY_C_FORMATS = new Set(['t10', 'hundred', 'the hundred'])

/** Marquee competition markers, matched against the provider's own series name. */
const MARQUEE_SERIES = /\b(world cup|champions trophy|asia cup|olympic|commonwealth|premier league|super league|ipl|psl|bbl|cpl|sa20|ilt20|the hundred|county championship|sheffield shield|ranji)\b/i

export interface CricketClassificationInput {
  matchType?: unknown
  series?: unknown
}

export function classifyCricketFixture(input: CricketClassificationInput): CricketCategory {
  const matchType = typeof input.matchType === 'string' ? input.matchType.trim().toLowerCase() : ''
  if (!matchType) return 'D'

  if (CATEGORY_A_FORMATS.has(matchType)) return 'A'
  if (CATEGORY_B_FORMATS.has(matchType)) return 'B'
  if (CATEGORY_C_FORMATS.has(matchType)) {
    const series = typeof input.series === 'string' ? input.series.trim() : ''
    return MARQUEE_SERIES.test(series) ? 'C' : 'D'
  }

  return 'D'
}

export function isCricketCategoryEligible(category: CricketCategory): boolean {
  return category !== 'D'
}
