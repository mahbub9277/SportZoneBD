/**
 * Module-level so a single intentional highlight open is counted exactly once per page session,
 * even when React StrictMode double-invokes the handler or the card remounts.
 */
const countedHighlightIds = new Set<string>()

/** Returns true only for the first claim of a highlight id in this page session. */
export function claimHighlightView(highlightId: string): boolean {
  if (countedHighlightIds.has(highlightId)) return false
  countedHighlightIds.add(highlightId)
  return true
}
