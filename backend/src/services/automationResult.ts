/**
 * Derives the automation log status from per-competition discovery outcomes.
 * A provider returning no fixtures is not a failure; only a request error is.
 */
export function resolveDiscoveryStatus(
  attemptedCount: number,
  failedCount: number,
): 'SUCCESS' | 'PARTIAL' | 'FAILED' {
  if (failedCount === 0) return 'SUCCESS'
  if (attemptedCount > 0 && failedCount >= attemptedCount) return 'FAILED'
  return 'PARTIAL'
}

export function summarizeDiscoveryResult(
  createdCount: number,
  updatedCount: number,
  skippedCount: number,
  attemptedCount: number,
  failedCompetitions: readonly string[],
): string {
  const base = `Created ${createdCount}, updated ${updatedCount}, skipped ${skippedCount}`

  return failedCompetitions.length === 0
    ? base
    : `${base}, ${failedCompetitions.length}/${attemptedCount} competitions failed (${failedCompetitions.join(', ')})`
}
