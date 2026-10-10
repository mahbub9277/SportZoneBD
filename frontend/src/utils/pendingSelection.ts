/**
 * Selection state for the pending-queue bulk actions.
 *
 * Selection is always an explicit set of match ids, so a bulk action can only ever apply to fixtures the
 * reviewer actually ticked. When the list changes — a new filter, a new page, a refresh — the ids that are
 * no longer on screen are dropped instead of being carried along invisibly, and "select all" only ever
 * covers the rows that are visible at that moment.
 */

export type PendingSelection = ReadonlySet<string>

export function togglePendingSelection(selection: PendingSelection, id: string, selected: boolean): Set<string> {
  const next = new Set(selection)
  if (selected) next.add(id)
  else next.delete(id)
  return next
}

/** Ticks or unticks every currently visible row, leaving ids from other pages untouched. */
export function setVisibleSelection(selection: PendingSelection, visibleIds: readonly string[], selected: boolean): Set<string> {
  const next = new Set(selection)
  for (const id of visibleIds) {
    if (selected) next.add(id)
    else next.delete(id)
  }
  return next
}

/**
 * Keeps only the rows that are still listed. Called whenever the filters, the page or the data change, so
 * a stale id can never be submitted by a bulk action.
 */
export function prunePendingSelection(selection: PendingSelection, visibleIds: readonly string[]): Set<string> {
  const visible = new Set(visibleIds)
  return new Set([...selection].filter((id) => visible.has(id)))
}

export interface PendingSelectionSummary {
  count: number
  /** True when every visible row is selected and there is at least one row. */
  allVisibleSelected: boolean
  /** True when some but not all visible rows are selected, which is what the header checkbox shows. */
  someVisibleSelected: boolean
}

export function summarizePendingSelection(selection: PendingSelection, visibleIds: readonly string[]): PendingSelectionSummary {
  const selectedVisible = visibleIds.filter((id) => selection.has(id))
  return {
    count: selection.size,
    allVisibleSelected: visibleIds.length > 0 && selectedVisible.length === visibleIds.length,
    someVisibleSelected: selectedVisible.length > 0 && selectedVisible.length < visibleIds.length,
  }
}
