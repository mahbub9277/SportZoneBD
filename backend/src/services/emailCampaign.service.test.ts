import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMAIL_CAMPAIGN_MAX_RECIPIENTS, EMAIL_AUDIENCES, isEmailAudience, planEmailCampaign } from './emailCampaign.service.js'

test('a campaign smaller than the limit contacts everyone', () => {
  assert.deepEqual(planEmailCampaign(40, 500), { take: 40, truncated: false })
})

test('a campaign larger than the limit is truncated and says so', () => {
  assert.deepEqual(planEmailCampaign(5000, 500), { take: 500, truncated: true })
  assert.deepEqual(planEmailCampaign(501, 500), { take: 500, truncated: true })
  assert.deepEqual(planEmailCampaign(500, 500), { take: 500, truncated: false })
})

test('an empty or unusable limit never becomes an unbounded send', () => {
  assert.deepEqual(planEmailCampaign(10, 0), { take: 0, truncated: true })
  assert.deepEqual(planEmailCampaign(10, Number.NaN), { take: 0, truncated: true })
  assert.deepEqual(planEmailCampaign(0, 500), { take: 0, truncated: false })
  assert.deepEqual(planEmailCampaign(-5, 500), { take: 0, truncated: false })
})

test('the default limit is a real, finite cap', () => {
  assert.ok(Number.isFinite(EMAIL_CAMPAIGN_MAX_RECIPIENTS))
  assert.ok(EMAIL_CAMPAIGN_MAX_RECIPIENTS > 0)
})

test('only the audiences the platform supports are accepted', () => {
  assert.deepEqual(EMAIL_AUDIENCES, ['ALL', 'PREMIUM', 'FREE'])
  assert.equal(isEmailAudience('PREMIUM'), true)
  assert.equal(isEmailAudience('EVERYONE'), false)
  assert.equal(isEmailAudience(undefined), false)
})
