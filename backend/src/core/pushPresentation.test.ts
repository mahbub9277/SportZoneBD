import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMatchPushLink,
  buildMatchPushPresentation,
  buildPushMessage,
  isMatchPushDeliveryValid,
  parseMatchPushLink,
  MATCH_REMINDER_TITLE,
  MATCH_STARTED_TITLE,
} from './pushPresentation.js'

const kickoff = new Date('2026-10-09T17:45:00.000Z')

const match = {
  id: '7ed8bc2e-bc93-4f23-8794-33010005a39c',
  title: 'Moreirense FC vs Gil Vicente FC',
  kickoffAt: kickoff,
  tournamentName: 'Primeira Liga',
  homeTeamLogo: 'https://crests.football-data.org/583.png',
  awayTeamLogo: 'https://crests.football-data.org/5533.png',
}

test('a reminder link keeps the match destination and carries the kickoff it was scheduled for', () => {
  const link = buildMatchPushLink(match.id, kickoff)
  assert.equal(link, `/matches/${match.id}?k=${kickoff.getTime()}`)
  assert.deepEqual(parseMatchPushLink(link), { matchId: match.id, kickoffMarker: String(kickoff.getTime()) })

  const plain = `/matches/${match.id}`
  assert.deepEqual(parseMatchPushLink(plain), { matchId: match.id, kickoffMarker: null })
})

test('the reminder identity changes with the kickoff, so a reschedule is never suppressed', () => {
  const moved = new Date(kickoff.getTime() + 90 * 60 * 1000)
  assert.notEqual(buildMatchPushLink(match.id, kickoff), buildMatchPushLink(match.id, moved))
  assert.deepEqual(parseMatchPushLink(buildMatchPushLink(match.id, moved))?.kickoffMarker, String(moved.getTime()))
})

test('unrelated links never resolve to a match push', () => {
  assert.equal(parseMatchPushLink(undefined), null)
  assert.equal(parseMatchPushLink(null), null)
  assert.equal(parseMatchPushLink('/notifications'), null)
  assert.equal(parseMatchPushLink('/matches/not-a-uuid'), null)
  assert.equal(parseMatchPushLink('https://evil.test/matches/7ed8bc2e-bc93-4f23-8794-33010005a39c'), null)
  assert.equal(parseMatchPushLink(`/matches/${match.id}?k=abc`), null)
})

test('a reminder keeps the existing status text and carries both real crests and the real competition', () => {
  const presentation = buildMatchPushPresentation(match, 'reminder')

  assert.equal(presentation.title, MATCH_REMINDER_TITLE)
  assert.equal(presentation.body, 'Moreirense FC vs Gil Vicente FC starts soon! Tap to watch live.')
  assert.equal(presentation.link, `/matches/${match.id}?k=${kickoff.getTime()}`)
  assert.equal(presentation.extras.icon, match.homeTeamLogo, 'the home crest is the notification icon')
  assert.equal(presentation.extras.image, match.awayTeamLogo, 'the away crest is the expanded image')
  assert.equal(presentation.extras.competition, 'Primeira Liga')
  assert.equal(presentation.extras.kickoffAt, kickoff.toISOString())
  assert.equal(presentation.extras.kind, 'reminder')
})

test('the shared title and body stay exactly as they were, so the in-app toast is untouched', () => {
  const source = { ...match, tournamentName: 'Premier League' }

  assert.equal(buildMatchPushPresentation(source, 'reminder').body, `${match.title} starts soon! Tap to watch live.`)
  assert.equal(buildMatchPushPresentation(source, 'started').body, `${match.title} has started! Tap to watch live.`)
  assert.equal(buildMatchPushPresentation(source, 'started').title, MATCH_STARTED_TITLE)
})

test('the kickoff alert reports the real status and does not offer a kickoff time', () => {
  const presentation = buildMatchPushPresentation(match, 'started')

  assert.equal(presentation.title, MATCH_STARTED_TITLE)
  assert.equal(presentation.link, `/matches/${match.id}`, 'a started match has no schedule marker')
  assert.equal(presentation.extras.kickoffAt, null)
  assert.equal(presentation.extras.competition, 'Primeira Liga')
})

test('a missing crest leaves its slot empty instead of inventing one', () => {
  const onlyHome = buildMatchPushPresentation({ ...match, awayTeamLogo: null }, 'reminder')
  assert.equal(onlyHome.extras.icon, match.homeTeamLogo)
  assert.equal(onlyHome.extras.image, null, 'one logo is never shown twice')

  const onlyAway = buildMatchPushPresentation({ ...match, homeTeamLogo: null }, 'reminder')
  assert.equal(onlyAway.extras.icon, match.awayTeamLogo)
  assert.equal(onlyAway.extras.image, null)

  const none = buildMatchPushPresentation({ ...match, homeTeamLogo: null, awayTeamLogo: null }, 'reminder')
  assert.equal(none.extras.icon, null)
  assert.equal(none.extras.image, null)
})

test('only https crest URLs are trusted, and oversized ones are refused', () => {
  assert.equal(buildMatchPushPresentation({ ...match, homeTeamLogo: 'http://insecure.test/a.png' }, 'reminder').extras.icon, match.awayTeamLogo)
  assert.equal(buildMatchPushPresentation({ ...match, homeTeamLogo: 'javascript:alert(1)' }, 'reminder').extras.icon, match.awayTeamLogo)
  assert.equal(buildMatchPushPresentation({ ...match, homeTeamLogo: `https://crests.test/${'a'.repeat(600)}.png` }, 'reminder').extras.icon, match.awayTeamLogo)
  assert.equal(buildMatchPushPresentation({ ...match, homeTeamLogo: 'not a url' }, 'reminder').extras.icon, match.awayTeamLogo)
})

test('an unknown competition is omitted, and known ones are kept to one readable line', () => {
  assert.equal(buildMatchPushPresentation({ ...match, tournamentName: null }, 'reminder').extras.competition, null)
  assert.equal(buildMatchPushPresentation({ ...match, tournamentName: '   ' }, 'reminder').extras.competition, null)
  assert.equal(buildMatchPushPresentation({ ...match, tournamentName: undefined }, 'reminder').extras.competition, null)

  const multiline = buildMatchPushPresentation({ ...match, tournamentName: 'La Liga\n\nRound 9\u0000' }, 'reminder')
  assert.equal(multiline.extras.competition, 'La Liga Round 9')

  const long = buildMatchPushPresentation({ ...match, tournamentName: 'x'.repeat(200) }, 'reminder')
  assert.ok((long.extras.competition?.length ?? 0) <= 60)
  assert.ok(long.extras.competition?.startsWith('x'.repeat(40)))
})

test('the competition is never inferred from a team name', () => {
  const presentation = buildMatchPushPresentation(
    { ...match, tournamentName: null, title: 'Premier League select vs La Liga all stars' },
    'reminder',
  )
  assert.equal(presentation.extras.competition, null)
  assert.ok(presentation.body.startsWith('Premier League select vs La Liga all stars starts soon'))
})

test('delivery is refused once the reminder no longer matches the match schedule', () => {
  const marker = String(kickoff.getTime())
  const stillUpcoming = { status: 'UPCOMING', kickoffAt: kickoff, deletedAt: null }

  assert.equal(isMatchPushDeliveryValid('reminder', marker, stillUpcoming), true)
  assert.equal(isMatchPushDeliveryValid('reminder', marker, { ...stillUpcoming, status: 'LIVE' }), false)
  assert.equal(isMatchPushDeliveryValid('reminder', marker, { ...stillUpcoming, status: 'FINISHED' }), false)
  assert.equal(isMatchPushDeliveryValid('reminder', marker, { ...stillUpcoming, status: 'REJECTED' }), false)
  assert.equal(isMatchPushDeliveryValid('reminder', marker, { ...stillUpcoming, deletedAt: new Date() }), false)
  assert.equal(isMatchPushDeliveryValid('reminder', marker, null), false)
})

test('a moved kickoff makes the old reminder obsolete but not its replacement', () => {
  const marker = String(kickoff.getTime())
  const moved = new Date(kickoff.getTime() + 60 * 60 * 1000)

  assert.equal(isMatchPushDeliveryValid('reminder', marker, { status: 'UPCOMING', kickoffAt: moved, deletedAt: null }), false)
  assert.equal(
    isMatchPushDeliveryValid('reminder', String(moved.getTime()), { status: 'UPCOMING', kickoffAt: moved, deletedAt: null }),
    true,
    'the reminder scheduled for the new kickoff is delivered',
  )
  assert.equal(isMatchPushDeliveryValid('reminder', null, { status: 'UPCOMING', kickoffAt: moved, deletedAt: null }), true)
})

test('a start alert is only delivered for a match that really started', () => {
  const live = { status: 'LIVE', kickoffAt: kickoff, deletedAt: null }

  assert.equal(isMatchPushDeliveryValid('started', null, live), true)
  // A finished match really did start, so the alert stays truthful instead of being dropped when the
  // worker is briefly behind. Only a match that never started must not claim that it did.
  assert.equal(isMatchPushDeliveryValid('started', null, { ...live, status: 'FINISHED' }), true)
  assert.equal(isMatchPushDeliveryValid('started', null, { ...live, status: 'UPCOMING' }), false)
  assert.equal(isMatchPushDeliveryValid('started', null, { ...live, status: 'PENDING' }), false)
  assert.equal(isMatchPushDeliveryValid('started', null, { ...live, status: 'REJECTED' }), false)
  assert.equal(isMatchPushDeliveryValid('started', null, { ...live, deletedAt: new Date() }), false)
})

test('alerts without match context are left to the existing delivery rules', () => {
  assert.equal(isMatchPushDeliveryValid(null, null, null), true)
})

test('the pushed payload carries both crests and stays small', () => {
  const presentation = buildMatchPushPresentation(match, 'reminder')
  const payload = buildPushMessage({
    title: presentation.title,
    body: presentation.body,
    type: 'match-reminder',
    link: presentation.link,
    notificationId: '5b1e2b1a-1111-4222-8333-444455556666',
    extras: presentation.extras,
  })
  const parsed = JSON.parse(payload)

  assert.equal(parsed.icon, match.homeTeamLogo)
  assert.equal(parsed.image, match.awayTeamLogo)
  assert.equal(parsed.matchId, match.id)
  assert.equal(parsed.kind, 'reminder')
  assert.equal(parsed.kickoffAt, kickoff.toISOString())
  assert.equal(parsed.competition, 'Primeira Liga')
  assert.equal(parsed.link, `/matches/${match.id}?k=${kickoff.getTime()}`)
  assert.ok(Buffer.byteLength(payload, 'utf8') < 800, `payload was ${Buffer.byteLength(payload, 'utf8')} bytes`)

  // The in-app channel is never part of a push payload: nothing here can reach the inbox or the badge.
  assert.equal(parsed.channel, undefined)
  assert.equal(parsed.isRead, undefined)
})

test('a push without match context keeps its previous shape', () => {
  const payload = JSON.parse(buildPushMessage({
    title: 'New Highlight Available',
    body: 'Highlights are ready.',
    type: 'success',
    link: '/notifications',
    notificationId: 'abc',
  }))

  assert.equal(payload.icon, undefined)
  assert.equal(payload.image, undefined)
  assert.equal(payload.matchId, undefined)
  assert.equal(payload.kickoffAt, undefined)
  assert.equal(payload.competition, undefined)
  assert.equal(payload.link, '/notifications')
})
