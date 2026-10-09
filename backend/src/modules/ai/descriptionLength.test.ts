import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkDescriptionLength,
  countDescriptionCharacters,
  fitDescriptionToLengthRange,
  lastSentenceBoundaryWithin,
  normalizeDescriptionText,
} from './descriptionLength.js'

const MATCH_RANGE = { min: 80, max: 100 }

test('the count is the reader-facing text, not its markup or spacing', () => {
  assert.equal(countDescriptionCharacters('  Bangladesh vs India  '), 19)
  assert.equal(countDescriptionCharacters('<p>Bangladesh &amp; India</p>'), 18)
  assert.equal(countDescriptionCharacters('"A short line."'), 13)
  assert.equal(countDescriptionCharacters('one\n\n  line   here'), 13)
  assert.equal(countDescriptionCharacters(''), 0)
})

test('a Bangla character counts as one, not as its UTF-16 length', () => {
  const bangla = 'বাংলাদেশ বনাম ভারত'
  assert.equal(countDescriptionCharacters(bangla), Array.from(bangla).length)
  assert.equal(countDescriptionCharacters(bangla), 18)
})

test('the match range accepts only text between 80 and 100 characters', () => {
  assert.equal(checkDescriptionLength('x'.repeat(79), MATCH_RANGE).reason, 'too-short')
  assert.equal(checkDescriptionLength('x'.repeat(80), MATCH_RANGE).inRange, true)
  assert.equal(checkDescriptionLength('x'.repeat(100), MATCH_RANGE).inRange, true)
  assert.equal(checkDescriptionLength('x'.repeat(101), MATCH_RANGE).reason, 'too-long')

  // Markup is not counted, so a description wrapped in tags still passes.
  const wrapped = `<p>${'x'.repeat(80)}</p>`
  assert.equal(checkDescriptionLength(wrapped, MATCH_RANGE).length, 80)
  assert.equal(checkDescriptionLength(wrapped, MATCH_RANGE).inRange, true)
})

test('a too-long description is shortened only by dropping whole trailing sentences', () => {
  const first = 'Bangladesh host India in the Asia Cup opener tonight in Dhaka, with both squads at full strength.'
  const second = 'Coverage begins thirty minutes before the first ball.'
  const text = `${first} ${second}`
  assert.ok(countDescriptionCharacters(first) >= 80, `first sentence was ${countDescriptionCharacters(first)}`)
  assert.ok(countDescriptionCharacters(text) > 100)

  const fitted = fitDescriptionToLengthRange(text, MATCH_RANGE)
  assert.equal(fitted.inRange, true)
  assert.ok(fitted.length >= 80 && fitted.length <= 100, `length was ${fitted.length}`)
  // The kept text is a prefix of the original: nothing was re-worded, only dropped.
  assert.ok(text.startsWith(fitted.text))
  assert.ok(fitted.text.endsWith('.'))
  assert.equal(fitted.text, first)
})

test('a single sentence that is too long is never cut mid-word or mid-sentence', () => {
  const text = `Bangladesh host India tonight in what the organisers describe as ${'a'.repeat(60)} fixture`
  const fitted = fitDescriptionToLengthRange(text, MATCH_RANGE)
  assert.equal(fitted.inRange, false)
  assert.equal(fitted.reason, 'too-long')
  // The text is returned untouched: refusing is correct, mangling it is not.
  assert.equal(fitted.text, normalizeDescriptionText(text))
})

test('a description that is too short is refused rather than padded', () => {
  const text = 'Bangladesh vs India tonight.'
  const fitted = fitDescriptionToLengthRange(text, MATCH_RANGE)
  assert.equal(fitted.inRange, false)
  assert.equal(fitted.reason, 'too-short')
  assert.equal(fitted.text, text, 'no filler is ever appended')
  assert.equal(fitted.length, countDescriptionCharacters(text))
})

test('dropping a sentence never takes the text below the minimum', () => {
  const long = 'A'.repeat(70) + '. ' + 'B'.repeat(70) + '.'
  const range = { min: 80, max: 100 }
  const fitted = fitDescriptionToLengthRange(long, range)
  // Dropping the second sentence would leave 71 characters, below the minimum, so it is not dropped.
  assert.equal(fitted.inRange, false)
  assert.equal(fitted.text, normalizeDescriptionText(long))
})

test('sentence boundaries are only recognised at a real end of sentence', () => {
  assert.equal(lastSentenceBoundaryWithin('One. Two.', 20), 9)
  assert.equal(lastSentenceBoundaryWithin('One. Two.', 4), 4)
  assert.equal(lastSentenceBoundaryWithin('no boundary here', 20), null)
  // A Bangla danda ends a sentence, and each Bangla character is one code point: the first sentence
  // ends at 16, the whole text at 29, so a limit of 20 keeps the first boundary only.
  assert.equal(lastSentenceBoundaryWithin('বাংলাদেশ জিতেছে। ভারত হেরেছে।', 30), 29)
  assert.equal(lastSentenceBoundaryWithin('বাংলাদেশ জিতেছে। ভারত হেরেছে।', 20), 16)
})
