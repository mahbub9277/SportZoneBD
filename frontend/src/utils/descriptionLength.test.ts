import assert from 'node:assert/strict'
import test from 'node:test'
import { countDescriptionCharacters, isDescriptionWithinRange, normalizeDescriptionText } from './descriptionLength.ts'

const RANGE = { min: 80, max: 100 }

test('the client counts the same reader-facing text the server counts', () => {
  assert.equal(countDescriptionCharacters('  Bangladesh vs India  '), 19)
  assert.equal(countDescriptionCharacters('<p>Bangladesh &amp; India</p>'), 18)
  assert.equal(countDescriptionCharacters('"A short line."'), 13)
  assert.equal(countDescriptionCharacters('one\n\n  line   here'), 13)
  assert.equal(normalizeDescriptionText('<b>Bold</b> text'), 'Bold text')
})

test('a Bangla description is measured in characters, not UTF-16 units', () => {
  const bangla = 'বাংলাদেশ বনাম ভারত'
  assert.equal(countDescriptionCharacters(bangla), 18)
})

test('only text between 80 and 100 characters is accepted', () => {
  assert.equal(isDescriptionWithinRange('x'.repeat(79), RANGE), false)
  assert.equal(isDescriptionWithinRange('x'.repeat(80), RANGE), true)
  assert.equal(isDescriptionWithinRange('x'.repeat(100), RANGE), true)
  assert.equal(isDescriptionWithinRange('x'.repeat(101), RANGE), false)
  assert.equal(isDescriptionWithinRange(`<p>${'x'.repeat(80)}</p>`, RANGE), true)
})
