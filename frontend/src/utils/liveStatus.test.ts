import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LIVE_BADGE_CLASS,
  LIVE_DOT_CLASS,
  LIVE_TEXT_CLASS,
  MATCH_STATUS_BADGE_CLASS,
  MATCH_STATUS_DOT_CLASS,
  MATCH_STATUS_TEXT_CLASS,
  formatViewerCount,
  matchStatusTone,
} from './liveStatus.ts'

test('viewer counts below a thousand stay exact', () => {
  assert.equal(formatViewerCount(0), '0')
  assert.equal(formatViewerCount(7), '7')
  assert.equal(formatViewerCount(999), '999')
})

test('thousands and millions are abbreviated the way the live line shows them', () => {
  assert.equal(formatViewerCount(1_000), '1.0K')
  assert.equal(formatViewerCount(1_250), '1.3K')
  assert.equal(formatViewerCount(999_999), '1000.0K')
  assert.equal(formatViewerCount(1_000_000), '1.0M')
  assert.equal(formatViewerCount(2_450_000), '2.5M')
})

test('the live treatment states its light and dark colour so it can never render unreadable', () => {
  for (const className of [LIVE_BADGE_CLASS, LIVE_TEXT_CLASS]) {
    assert.match(className, /text-emerald-\d+/)
    assert.match(className, /dark:text-emerald-\d+/)
  }
  assert.match(LIVE_DOT_CLASS, /bg-emerald-\d+/)
  assert.match(LIVE_DOT_CLASS, /dark:bg-emerald-\d+/)
})

test('the stored match status maps onto the three drawn states', () => {
  assert.equal(matchStatusTone('LIVE'), 'LIVE')
  assert.equal(matchStatusTone('live'), 'LIVE')
  assert.equal(matchStatusTone('FINISHED'), 'FINISHED')
  assert.equal(matchStatusTone('UPCOMING'), 'UPCOMING')
  // Anything the UI does not draw as its own state stays upcoming rather than inventing a colour.
  assert.equal(matchStatusTone('PENDING'), 'UPCOMING')
  assert.equal(matchStatusTone('REJECTED'), 'UPCOMING')
  assert.equal(matchStatusTone(''), 'UPCOMING')
  assert.equal(matchStatusTone(null), 'UPCOMING')
  assert.equal(matchStatusTone(undefined), 'UPCOMING')
})

test('live is red, upcoming is amber and finished is green, in both themes', () => {
  assert.equal(MATCH_STATUS_BADGE_CLASS.LIVE, 'match-status match-status--live')
  assert.equal(MATCH_STATUS_BADGE_CLASS.UPCOMING, 'match-status match-status--upcoming')
  assert.equal(MATCH_STATUS_BADGE_CLASS.FINISHED, 'match-status match-status--finished')
  assert.equal(MATCH_STATUS_TEXT_CLASS.LIVE, 'match-status-text--live')
  assert.equal(MATCH_STATUS_TEXT_CLASS.UPCOMING, 'match-status-text--upcoming')
  assert.equal(MATCH_STATUS_TEXT_CLASS.FINISHED, 'match-status-text--finished')

  // The wording matches what a viewer sees, so the tones cannot drift apart from the CSS.
  assert.match(MATCH_STATUS_BADGE_CLASS.LIVE, /live/)
  assert.match(MATCH_STATUS_BADGE_CLASS.UPCOMING, /upcoming/)
  assert.match(MATCH_STATUS_BADGE_CLASS.FINISHED, /finished/)
})

test('every tone is declared for the dark theme and overridden for the light theme', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const darkTokens = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='light']"))
  const lightTokens = css.slice(
    css.indexOf(":root[data-theme='light']"),
    css.indexOf('.match-status {'),
  )

  for (const tone of ['live', 'upcoming', 'finished'] as const) {
    // A text token plus the dot and border/glow tokens, declared twice: once per theme.
    for (const token of ['', '-dot', '-ring']) {
      const declaration = new RegExp(`--match-${tone}${token}:`, 'g')
      assert.equal(
        (darkTokens.match(declaration) ?? []).length,
        1,
        `--match-${tone}${token} must be declared in the dark theme`,
      )
      assert.equal(
        (lightTokens.match(declaration) ?? []).length,
        1,
        `--match-${tone}${token} must be declared for the light theme`,
      )
    }

    // The rules themselves must consume the tokens, never a hard-coded colour.
    assert.match(css, new RegExp(`\\.match-status--${tone} \\{[\\s\\S]*?color: var\\(--match-${tone}\\)`))
    assert.match(css, new RegExp(`\\.match-status-text--${tone} \\{[\\s\\S]*?color: var\\(--match-${tone}\\)`))
    assert.match(css, new RegExp(`\\.match-status--${tone} \\.match-status-dot \\{[\\s\\S]*?background: var\\(--match-${tone}-dot\\)`))
  }
})

test('the live status carries a soft glow, and no shared class forces an animation', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  assert.match(css, /\.match-status--live \{[\s\S]*?box-shadow: 0 0 14px var\(--match-live-glow\)/)
  assert.match(css, /\.match-status--live \.match-status-dot \{[\s\S]*?box-shadow: 0 0 10px var\(--match-live-glow\)/)

  // The pulse is the caller's decision, and it is always `motion-safe`; a bare animation here would
  // run even when the viewer asked for reduced motion.
  for (const tone of ['LIVE', 'UPCOMING', 'FINISHED'] as const) {
    const classes = [
      MATCH_STATUS_BADGE_CLASS[tone],
      MATCH_STATUS_DOT_CLASS,
      MATCH_STATUS_TEXT_CLASS[tone],
    ].join(' ')
    assert.doesNotMatch(classes, /(?<!motion-safe:)animate-/)
  }
})

test('the health accent stays green so status red never bleeds into it', () => {
  assert.match(LIVE_BADGE_CLASS, /emerald/)
  assert.doesNotMatch(LIVE_BADGE_CLASS, /red-/)
  assert.match(MATCH_STATUS_DOT_CLASS, /match-status-dot/)
  assert.doesNotMatch(LIVE_DOT_CLASS, /match-status/)
})
