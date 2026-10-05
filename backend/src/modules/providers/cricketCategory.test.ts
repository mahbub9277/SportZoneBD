import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyCricketFixture, isCricketCategoryEligible } from './cricketCategory.js'

test('long formats are category A and always eligible', () => {
  assert.equal(classifyCricketFixture({ matchType: 'test' }), 'A')
  assert.equal(classifyCricketFixture({ matchType: 'ODI' }), 'A')
  assert.equal(isCricketCategoryEligible('A'), true)
})

test('the main short format is category B and always eligible', () => {
  assert.equal(classifyCricketFixture({ matchType: 't20' }), 'B')
  assert.equal(classifyCricketFixture({ matchType: ' T20I ' }), 'B')
  assert.equal(isCricketCategoryEligible('B'), true)
})

test('other short formats are category C only for a marquee series', () => {
  assert.equal(classifyCricketFixture({ matchType: 't10', series: 'Abu Dhabi T10 League' }), 'D')
  assert.equal(classifyCricketFixture({ matchType: 't10', series: 'T10 World Cup 2026' }), 'C')
  assert.equal(classifyCricketFixture({ matchType: 'the hundred', series: 'The Hundred Men' }), 'C')
  assert.equal(isCricketCategoryEligible('C'), true)
})

test('unknown or missing formats are category D and never eligible', () => {
  assert.equal(classifyCricketFixture({ matchType: undefined, series: 'Some Series' }), 'D')
  assert.equal(classifyCricketFixture({ matchType: '', series: 'Some Series' }), 'D')
  assert.equal(classifyCricketFixture({ matchType: 'firstclass', series: 'County Championship' }), 'D')
  assert.equal(classifyCricketFixture({ matchType: 42, series: 'Some Series' }), 'D')
  assert.equal(isCricketCategoryEligible('D'), false)
})
