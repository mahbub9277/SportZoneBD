/**
 * IntersectionObserver root margins only accept pixel or percentage lengths. A bare number, a
 * unitless token, or a malformed value — for example a "-" prepended to an already negative inset,
 * which yields "--212px" — makes the constructor throw:
 *
 *   SyntaxError: Failed to construct 'IntersectionObserver': rootMargin must be specified in pixels
 *   or percent.
 *
 * These helpers keep every rootMargin on the accepted form: four explicit lengths, each with a
 * unit, so a call site can never take the observer (and the component that owns it) down.
 */
const LENGTH_TOKEN = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(px|%)?$/i
const SAFE_ROOT_MARGIN = '0px 0px 0px 0px'
const DEFAULT_HEADER_GAP_PX = 8
/** Clearance used when no header position is measurable: the 80px header fallback plus the gap. */
const MISSING_HEADER_CLEARANCE_PX = 88

function toLengthToken(token: string): string | null {
  const match = LENGTH_TOKEN.exec(token)
  if (!match) return null

  const magnitude = Number(match[1])
  if (!Number.isFinite(magnitude)) return null
  // Zero is always written as "0px": a bare "0" is rejected by the observer constructor just like
  // any other unitless token, and 0% and 0px describe the same margin.
  if (magnitude === 0) return '0px'

  return `${match[1]}${(match[2] ?? 'px').toLowerCase()}`
}

/**
 * Normalizes a CSS-margin style value into four explicit pixel/percentage lengths. Unitless numbers
 * become pixels and the 1-3 value shorthand is expanded the way CSS defines it (top, right, bottom,
 * left). Anything that cannot produce four valid lengths falls back to a zero margin instead of
 * throwing, so a bad caller degrades to "no margin" rather than breaking the observer.
 */
export function normalizeRootMargin(value: string | number | null | undefined): string {
  const raw = typeof value === 'number' ? `${value}px` : String(value ?? '')
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 4) return SAFE_ROOT_MARGIN

  const sides = tokens.map(toLengthToken)
  if (sides.some((side) => side === null)) return SAFE_ROOT_MARGIN

  const [top, right = top, bottom = top, left = right] = sides as string[]
  return `${top} ${right} ${bottom} ${left}`
}

/**
 * Root margin for an observer that must ignore the strip covered by the site header.
 *
 * The header sits in normal document flow, so its bottom edge is negative once the page is scrolled
 * past it. The resulting clearance is clamped at zero — the header obstructs nothing then — which is
 * also what keeps a "minus" from being prepended to an already negative number.
 */
export function getRootMarginBelowHeader(headerBottom: number | null | undefined, gapPx = DEFAULT_HEADER_GAP_PX): string {
  const isMeasurable = typeof headerBottom === 'number' && Number.isFinite(headerBottom)
  const inset = isMeasurable ? Math.max(0, Math.ceil(headerBottom + gapPx)) : MISSING_HEADER_CLEARANCE_PX

  return inset > 0 ? normalizeRootMargin(`-${inset}px 0px 0px`) : SAFE_ROOT_MARGIN
}
