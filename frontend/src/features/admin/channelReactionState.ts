export type ChannelReactionType = 'LIKE' | 'DISLIKE'

export interface ChannelReactionSummary {
  likeCount: number
  dislikeCount: number
  userReaction: ChannelReactionType | null
}

export interface ScopedChannelReactionSummary {
  scope: string
  summary: ChannelReactionSummary
}

export const EMPTY_CHANNEL_REACTION_SUMMARY: ChannelReactionSummary = {
  likeCount: 0,
  dislikeCount: 0,
  userReaction: null,
}

export const getChannelReactionScopeKey = (channelId: string, viewerId: string | null): string =>
  JSON.stringify([channelId, viewerId])

export const selectChannelReactionSummary = (
  confirmed: ChannelReactionSummary | null | undefined,
  optimistic: ScopedChannelReactionSummary | null,
  scope: string,
): ChannelReactionSummary | null =>
  optimistic?.scope === scope ? optimistic.summary : confirmed ?? null

export const setChannelUserReaction = (
  current: ChannelReactionSummary,
  userReaction: ChannelReactionType | null,
): ChannelReactionSummary => ({
  likeCount: Math.max(
    0,
    current.likeCount
      + (userReaction === 'LIKE' ? 1 : 0)
      - (current.userReaction === 'LIKE' ? 1 : 0),
  ),
  dislikeCount: Math.max(
    0,
    current.dislikeCount
      + (userReaction === 'DISLIKE' ? 1 : 0)
      - (current.userReaction === 'DISLIKE' ? 1 : 0),
  ),
  userReaction,
})

export const toggleChannelUserReaction = (
  current: ChannelReactionSummary,
  type: ChannelReactionType,
): ChannelReactionSummary =>
  setChannelUserReaction(current, current.userReaction === type ? null : type)

export const isChannelReactionActive = (
  summary: ChannelReactionSummary,
  type: ChannelReactionType,
): boolean => summary.userReaction === type
