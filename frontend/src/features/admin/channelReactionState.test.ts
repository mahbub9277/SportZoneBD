import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getChannelReactionScopeKey,
  isChannelReactionActive,
  selectChannelReactionSummary,
  toggleChannelUserReaction,
  type ChannelReactionSummary,
} from './channelReactionState.ts'

const summary = (
  likeCount: number,
  dislikeCount: number,
  userReaction: ChannelReactionSummary['userReaction'],
): ChannelReactionSummary => ({ likeCount, dislikeCount, userReaction })

test('restores the saved Like and Dislike state from the confirmed server summary', () => {
  const savedLike = summary(3, 1, 'LIKE')
  const savedDislike = summary(2, 4, 'DISLIKE')

  assert.equal(isChannelReactionActive(savedLike, 'LIKE'), true)
  assert.equal(isChannelReactionActive(savedLike, 'DISLIKE'), false)
  assert.equal(isChannelReactionActive(savedDislike, 'DISLIKE'), true)
  assert.equal(isChannelReactionActive(savedDislike, 'LIKE'), false)
})

test('clicking an active reaction toggles it off and switching reaction types stays exclusive', () => {
  const savedLike = summary(3, 1, 'LIKE')

  assert.deepEqual(toggleChannelUserReaction(savedLike, 'LIKE'), summary(2, 1, null))
  assert.deepEqual(toggleChannelUserReaction(savedLike, 'DISLIKE'), summary(2, 2, 'DISLIKE'))
  assert.deepEqual(toggleChannelUserReaction(summary(2, 1, null), 'LIKE'), summary(3, 1, 'LIKE'))
})

test('optimistic state from another channel or account cannot override the current response', () => {
  const channelAUser1 = getChannelReactionScopeKey('channel-a', 'user-1')
  const channelAUser2 = getChannelReactionScopeKey('channel-a', 'user-2')
  const channelBUser1 = getChannelReactionScopeKey('channel-b', 'user-1')
  const optimistic = { scope: channelAUser1, summary: summary(5, 0, 'LIKE') }

  assert.deepEqual(selectChannelReactionSummary(summary(2, 3, 'DISLIKE'), optimistic, channelAUser2), summary(2, 3, 'DISLIKE'))
  assert.deepEqual(selectChannelReactionSummary(summary(1, 1, null), optimistic, channelBUser1), summary(1, 1, null))
  assert.notEqual(channelAUser1, channelAUser2)
  assert.notEqual(channelAUser1, channelBUser1)
})

test('a failed optimistic update can render the unchanged confirmed server state', () => {
  const confirmed = summary(4, 2, 'LIKE')
  const scope = getChannelReactionScopeKey('channel-a', 'user-1')
  const optimistic = { scope, summary: toggleChannelUserReaction(confirmed, 'LIKE') }

  assert.equal(selectChannelReactionSummary(confirmed, optimistic, scope)?.userReaction, null)
  assert.deepEqual(selectChannelReactionSummary(confirmed, null, scope), confirmed)
})
