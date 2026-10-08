import type { Channel, ChannelCategory } from '../../shared/types'

/**
 * A channel as TV Mode needs it: the real API data, flattened out of its categories and given the
 * channel number that belongs to its position in the catalogue.
 *
 * Nothing here is invented. The number is the 1-based position in the order the API returns
 * (category order, then channel order), so a channel keeps the same number across category filters and
 * searches, which is what makes it useful for remote-driven navigation.
 */
export interface TVChannel {
  id: string
  number: number
  name: string
  logo: string | null
  streamUrl: string | null
  categoryId: string
  categoryName: string
  /** A channel is live when the backend reports it active and it has a stream to play. */
  isLive: boolean
  isPremium: boolean
}

export interface TVCategory {
  id: string
  name: string
  count: number
}

export const TV_ALL_CATEGORY_ID = 'all'

/** Formats a channel number the way the TV list shows it (`#01`). */
export function formatChannelNumber(number: number): string {
  return `#${String(number).padStart(2, '0')}`
}

/**
 * Flattens the category tree into the TV channel list.
 *
 * A channel that the API lists in more than one category is kept once, at its first position, so the
 * same stream can never appear twice with two different numbers.
 */
export function buildTVChannels(categories: ChannelCategory[] | undefined | null): TVChannel[] {
  if (!categories?.length) return []

  const seen = new Set<string>()
  const channels: TVChannel[] = []

  for (const category of categories) {
    for (const channel of (category.channels ?? []) as Channel[]) {
      if (!channel?.id || seen.has(channel.id)) continue
      seen.add(channel.id)

      channels.push({
        id: channel.id,
        number: channels.length + 1,
        name: channel.name,
        logo: channel.logo ?? null,
        streamUrl: channel.url ?? null,
        categoryId: category.id,
        categoryName: category.name,
        isLive: channel.status === 'ACTIVE' && Boolean(channel.url),
        isPremium: channel.isPremium === true,
      })
    }
  }

  return channels
}

/** The category filter options: `All` plus the real categories that actually hold channels. */
export function buildTVCategories(categories: ChannelCategory[] | undefined | null, channels: TVChannel[]): TVCategory[] {
  if (!categories?.length) return []

  const counts = new Map<string, number>()
  for (const channel of channels) {
    counts.set(channel.categoryId, (counts.get(channel.categoryId) ?? 0) + 1)
  }

  return [
    { id: TV_ALL_CATEGORY_ID, name: 'All', count: channels.length },
    ...categories
      .filter((category) => (counts.get(category.id) ?? 0) > 0)
      .map((category) => ({ id: category.id, name: category.name, count: counts.get(category.id) ?? 0 })),
  ]
}

export interface TVChannelFilter {
  categoryId?: string
  query?: string
}

/**
 * Category and search filtering over the already-loaded catalogue.
 *
 * Searching is local on purpose: the whole channel list is a few hundred entries, so filtering it here
 * avoids a request per keystroke and keeps the player untouched while the user types.
 */
export function filterTVChannels(channels: TVChannel[], { categoryId = TV_ALL_CATEGORY_ID, query = '' }: TVChannelFilter = {}): TVChannel[] {
  const byCategory = categoryId === TV_ALL_CATEGORY_ID
    ? channels
    : channels.filter((channel) => channel.categoryId === categoryId)

  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return byCategory

  // `#03`, `03` and `3` all address channel 3: the leading zeros a viewer types are not significant.
  const digits = trimmed.replace(/^#/, '').replace(/^0+(?=\d)/, '')
  const isNumeric = /^\d+$/.test(digits)

  return byCategory.filter((channel) => {
    if (channel.name.toLowerCase().includes(trimmed)) return true
    if (channel.categoryName.toLowerCase().includes(trimmed)) return true
    if (isNumeric) {
      return String(channel.number) === digits || String(channel.number).startsWith(digits)
    }
    return false
  })
}
/** A channel the backend reports as live and that carries a stream to play. */
export function isChannelPlayable(channel: TVChannel): boolean {
  return channel.isLive && Boolean(channel.streamUrl)
}

/** The channels a viewer can actually start watching right now. */
export function playableChannels(channels: TVChannel[]): TVChannel[] {
  return channels.filter(isChannelPlayable)
}

/**
 * The single rule for "this viewer may watch this channel": it has to be playable and, when it is a
 * premium channel, the viewer has to be entitled to it. Channel zapping, the failure recovery and
 * Auto Tune all ask this one question, so none of them can drift into a different answer.
 */
export function isChannelWatchable(channel: TVChannel, isPremiumSubscriber: boolean): boolean {
  return isChannelPlayable(channel) && (!channel.isPremium || isPremiumSubscriber)
}

/**
 * Resolves a typed channel number against the real catalogue numbering.
 *
 * Only digits address a channel — the number a viewer types is the same number the list shows, not an
 * array index and not a database id — and leading zeros are not significant (`03` and `3` are channel
 * three). A number that no channel holds returns null, so the caller can report it instead of tuning.
 */
export function findChannelByNumber(channels: TVChannel[], digits: string): TVChannel | null {
  const trimmed = digits.trim()
  if (!/^\d+$/.test(trimmed)) return null

  const number = Number(trimmed)
  if (!Number.isSafeInteger(number) || number < 1) return null

  return channels.find((channel) => channel.number === number) ?? null
}

/**
 * The channel TV Mode opens with: the viewer's last channel when it is still playable, otherwise the
 * first playable channel in catalogue order.
 */
export function pickInitialChannelId(channels: TVChannel[], preferredId?: string | null): string | null {
  const playable = playableChannels(channels)
  if (preferredId && playable.some((channel) => channel.id === preferredId)) return preferredId
  return playable[0]?.id ?? null
}

/**
 * Channel up (`direction` 1) and channel down (-1) across the playable channels, wrapping at the ends
 * so zapping never dead-ends.
 */
export function stepChannelId(channels: TVChannel[], currentId: string | null, direction: 1 | -1): string | null {
  const playable = playableChannels(channels)
  if (playable.length === 0) return null
  if (playable.length === 1) return playable[0].id

  const index = playable.findIndex((channel) => channel.id === currentId)
  if (index === -1) return playable[0].id

  return playable[(index + direction + playable.length) % playable.length].id
}

/**
 * The channel an automatic recovery should move to after `failedId` would not play.
 *
 * It walks the same playable catalogue as zapping, wrapping at the end, but it only ever returns a
 * channel the caller still considers eligible, and it returns null rather than the failed channel:
 * a recovery that re-tunes the source that just failed is worse than leaving the error UI in place.
 */
export function nextPlayableChannelId(
  channels: TVChannel[],
  failedId: string | null,
  isEligible: (channel: TVChannel) => boolean = () => true,
): string | null {
  const candidates = playableChannels(channels).filter(isEligible)
  if (candidates.length === 0) return null

  const index = candidates.findIndex((channel) => channel.id === failedId)
  const next = candidates[index === -1 ? 0 : (index + 1) % candidates.length]
  return next.id === failedId ? null : next.id
}
