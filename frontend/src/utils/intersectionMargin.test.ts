import test from 'node:test'
import assert from 'node:assert/strict'
import { getRootMarginBelowHeader, normalizeRootMargin } from './intersectionMargin.ts'

const UNITLESS_TOKEN = /(^|\s)[+-]?(?:\d+(?:\.\d+)?|\.\d+)(\s|$)/

test('a raw number becomes an explicit pixel value on every side', () => {
  assert.equal(normalizeRootMargin(200), '200px 200px 200px 200px')
  assert.equal(normalizeRootMargin(0), '0px 0px 0px 0px')
  assert.equal(normalizeRootMargin(-24), '-24px -24px -24px -24px')
})

test('a single value is expanded to all four sides', () => {
  assert.equal(normalizeRootMargin('200px'), '200px 200px 200px 200px')
  assert.equal(normalizeRootMargin('10%'), '10% 10% 10% 10%')
})

test('unitless strings are given pixel units instead of being handed to the browser bare', () => {
  assert.equal(normalizeRootMargin('200'), '200px 200px 200px 200px')
  assert.equal(normalizeRootMargin('0'), '0px 0px 0px 0px')
  // Two values mean vertical horizontal, exactly as CSS reads them.
  assert.equal(normalizeRootMargin('-8 0px'), '-8px 0px -8px 0px')
})

test('the CSS shorthand is expanded the way the browser reads it', () => {
  assert.equal(normalizeRootMargin('-8% 0px'), '-8% 0px -8% 0px')
  assert.equal(normalizeRootMargin('-85px 0px 0px'), '-85px 0px 0px 0px')
  assert.equal(normalizeRootMargin('1px 2% 3px 4%'), '1px 2% 3px 4%')
})

test('a doubled sign — the string that crashed the mini player observer — falls back safely', () => {
  // Previously produced by `-${Math.ceil(headerBottom + 8)}px` once the header scrolled out of view.
  assert.equal(normalizeRootMargin('--212px 0px 0px'), '0px 0px 0px 0px')
  assert.equal(normalizeRootMargin('--8% 0px'), '0px 0px 0px 0px')
})

test('anything that is not one to four lengths falls back instead of throwing', () => {
  for (const value of ['', '   ', null, undefined, 'auto', '200px 200px 200px 200px 200px', 'calc(100% - 1px)', NaN, Infinity]) {
    assert.equal(normalizeRootMargin(value as string), '0px 0px 0px 0px', `expected a safe fallback for ${String(value)}`)
  }
})

test('every normalized value is safe for the observer constructor', () => {
  const inputs = [200, 0, -24, '200px', '10%', '-8% 0px', '-85px 0px 0px', '1px 2% 3px 4%', '0', '-0%', '--212px 0px 0px', 'auto']
  for (const input of inputs) {
    const margin = normalizeRootMargin(input)
    const tokens = margin.split(' ')
    assert.equal(tokens.length, 4, `${String(input)} should expand to four values`)
    for (const token of tokens) {
      assert.match(token, /^-?(?:\d+(?:\.\d+)?|\.\d+)(px|%)$/i, `token "${token}" from ${String(input)} must carry a unit`)
    }
  }
})

test('a scrolled-out header never produces a negative inset', () => {
  // The header is in normal flow, so its bottom edge is negative once the page is scrolled past it.
  // The clearance itself is clamped at zero, which is what used to become "--212px 0px 0px".
  assert.equal(getRootMarginBelowHeader(-220), '0px 0px 0px 0px')
  assert.equal(getRootMarginBelowHeader(-20), '0px 0px 0px 0px')
  assert.equal(getRootMarginBelowHeader(-8), '0px 0px 0px 0px')
})

test('a visible header keeps its clearance from the top of the viewport', () => {
  assert.equal(getRootMarginBelowHeader(76), '-84px 0px 0px 0px')
  assert.equal(getRootMarginBelowHeader(80), '-88px 0px 0px 0px')
  // A header sitting exactly at the viewport edge keeps only the configured gap.
  assert.equal(getRootMarginBelowHeader(0), '-8px 0px 0px 0px')
})

test('an unmeasurable header keeps the historical fallback clearance', () => {
  assert.equal(getRootMarginBelowHeader(null), '-88px 0px 0px 0px')
  assert.equal(getRootMarginBelowHeader(undefined), '-88px 0px 0px 0px')
  assert.equal(getRootMarginBelowHeader(Number.NaN), '-88px 0px 0px 0px')
})

test('header clearances are always constructible', () => {
  for (const headerBottom of [-5000, -220, -8, 0, 1, 76, 80, 1234, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const margin = getRootMarginBelowHeader(headerBottom as number)
    assert.equal(margin.includes('--'), false, `margin "${margin}" must not contain a doubled sign`)
    assert.equal(UNITLESS_TOKEN.test(margin), false, `margin "${margin}" must not contain a unitless token`)
    assert.doesNotThrow(() => margin.split(' ').forEach((token) => {
      if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)(px|%)$/i.test(token)) throw new Error(`invalid token ${token}`)
    }))
  }
})
