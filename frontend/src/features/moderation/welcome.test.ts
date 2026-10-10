import test from 'node:test'
import assert from 'node:assert/strict'
import { WELCOME_NAME_FALLBACK, buildWelcomeMessage, dayIndex, dayPartFor } from './welcome.ts'

test('the greeting follows the local time of day', () => {
  assert.equal(dayPartFor(6), 'morning')
  assert.equal(dayPartFor(11), 'morning')
  assert.equal(dayPartFor(12), 'afternoon')
  assert.equal(dayPartFor(16), 'afternoon')
  assert.equal(dayPartFor(17), 'evening')
  assert.equal(dayPartFor(23), 'evening')
  assert.equal(dayPartFor(0), 'morning')
})

test('an hour outside the clock is folded into a real day part instead of breaking the greeting', () => {
  assert.equal(dayPartFor(25), 'morning')
  assert.equal(dayPartFor(-1), 'evening')
  assert.equal(dayPartFor(Number.NaN), 'morning')
})

test('the message greets the signed-in display name', () => {
  const welcome = buildWelcomeMessage({ displayName: 'Rina Akter', now: new Date('2026-02-03T09:00:00') })

  assert.equal(welcome.greeting, 'Good morning, Rina Akter.')
  assert.ok(welcome.text.length > 20)
})

test('a name is trimmed, and a missing one uses the established fallback', () => {
  assert.equal(
    buildWelcomeMessage({ displayName: '  Rina  ', now: new Date('2026-02-03T14:00:00') }).greeting,
    'Good afternoon, Rina.',
  )
  assert.equal(buildWelcomeMessage({ displayName: null }).greeting.endsWith(WELCOME_NAME_FALLBACK + '.'), true)
  assert.equal(buildWelcomeMessage({ displayName: '   ' }).greeting.endsWith(WELCOME_NAME_FALLBACK + '.'), true)
})

test('the same day always produces the same message', () => {
  const morning = buildWelcomeMessage({ displayName: 'Rina', now: new Date('2026-02-03T08:10:00') })
  const later = buildWelcomeMessage({ displayName: 'Rina', now: new Date('2026-02-03T10:45:00') })

  assert.equal(morning.text, later.text, 'a re-render or a page change must not swap the wording')
})

test('the message moves on from one day to the next', () => {
  const texts = new Set(
    Array.from({ length: 4 }, (_, offset) => (
      buildWelcomeMessage({ displayName: 'Rina', now: new Date(2026, 4, 1 + offset, 9, 0, 0) }).text
    )),
  )

  assert.ok(texts.size > 1, 'the same sentence must not be the only one a moderator ever sees')
})

test('the same day is the same day index whatever the clock time', () => {
  assert.equal(dayIndex(new Date(2026, 6, 9, 0, 5)), dayIndex(new Date(2026, 6, 9, 23, 55)))
  assert.notEqual(dayIndex(new Date(2026, 6, 9, 23, 55)), dayIndex(new Date(2026, 6, 10, 0, 5)))
})

test('no message claims an achievement, a score or a work duration', () => {
  const forbidden = ['productivity', 'score', 'hours', 'top ', 'best ', 'achievement', 'streak']

  for (const dayPart of ['morning', 'afternoon', 'evening'] as const) {
    for (const hour of [9, 14, 20]) {
      const text = buildWelcomeMessage({ displayName: 'Rina', now: new Date(2026, 3, 14, hour, 0, 0) }).text.toLowerCase()
      assert.equal(text.startsWith('good '), false, 'the message itself is not a greeting twice over')
      for (const word of forbidden) {
        assert.equal(text.includes(word), false, `${dayPart} message must not mention "${word}"`)
      }
    }
  }
})
