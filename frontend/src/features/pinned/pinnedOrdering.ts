/**
 * Orders a channel list so pinned channels come first.
 *
 * The order inside both groups is left exactly as the caller produced it — including the pinned
 * group, because the project has no explicit pinned-order system — so the existing ordering of the
 * page survives; a pinned channel that is no longer present in the fetched data simply is not in the
 * list (no ghost entry), and the input array is never mutated.
 */
export function sortPinnedFirst<T extends { id: string }>(items: T[], pinnedIds: string[]): T[] {
  if (items.length === 0 || pinnedIds.length === 0) return items

  const pinnedSet = new Set(pinnedIds)
  const pinnedItems: T[] = []
  const remainingItems: T[] = []

  for (const item of items) {
    if (pinnedSet.has(item.id)) pinnedItems.push(item)
    else remainingItems.push(item)
  }

  // Nothing in this list is pinned: hand back the same array so memoised consumers stay stable.
  if (pinnedItems.length === 0) return items

  return [...pinnedItems, ...remainingItems]
}
