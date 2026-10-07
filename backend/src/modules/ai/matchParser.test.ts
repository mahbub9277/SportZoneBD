import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  extractCompetition,
  extractExplicitLocalDateTime,
  extractExplicitQuality,
  extractExplicitSport,
  extractExplicitTeams,
  extractMatchContext,
  extractRound,
  extractStreamUrl,
  formatTeamName,
  getSportDuration,
  isRejectedTeamName,
  mergeMatchExtraction,
  normalizeBangla,
} from './matchParser.js'
import { matchParseResultSchema } from './description.validator.js'

const TODAY = '2025-03-14'
const YESTERDAY = addDays(TODAY, -1)
const TOMORROW = addDays(TODAY, 1)

/**
 * Bengali র/য় have two canonically equivalent spellings, so assertions compare normalised text
 * instead of depending on how the literal happens to be encoded in this file.
 */
const expectBangla = (actual: string | null, expected: string, message?: string) => {
  assert.equal(actual === null ? null : normalizeBangla(actual), normalizeBangla(expected), message)
}

const emptyAiResult = (overrides: Partial<ReturnType<typeof matchParseResultSchema.parse>> = {}) => matchParseResultSchema.parse({
  title: null,
  tournamentName: null,
  sport: null,
  homeTeamName: null,
  awayTeamName: null,
  homeTeamLogo: null,
  awayTeamLogo: null,
  timezone: 'Asia/Dhaka',
  kickoffDate: null,
  kickoffTime: null,
  expectedDurationMinutes: null,
  autoFinish: null,
  preStartEnabled: null,
  preStartWindowMinutes: null,
  primaryStreamUrl: null,
  quality: null,
  confidence: {},
  warnings: [],
  ...overrides,
})

const merged = (input: string, aiOverrides: Partial<ReturnType<typeof matchParseResultSchema.parse>> = {}, teams: { homeTeam?: { id: string | null; name: string; logo: string | null } | null; awayTeam?: { id: string | null; name: string; logo: string | null } | null } = {}) =>
  mergeMatchExtraction({
    aiResult: emptyAiResult(aiOverrides),
    context: extractMatchContext(input, TODAY),
    homeTeam: teams.homeTeam ?? null,
    awayTeam: teams.awayTeam ?? null,
    timezone: 'Asia/Dhaka',
  })

// ---------------------------------------------------------------- English
test('English input resolves teams, competition, round, date and 24-hour time', () => {
  const result = merged('Real Madrid vs Barcelona today at 10:30 PM, La Liga round 5')
  assert.equal(result.homeTeamName, 'Real Madrid')
  assert.equal(result.awayTeamName, 'Barcelona')
  assert.equal(result.tournamentName, 'La Liga')
  assert.equal(result.round, 5)
  assert.equal(result.kickoffDate, TODAY)
  assert.equal(result.kickoffTime, '22:30')
  assert.equal(result.timezone, 'Asia/Dhaka')
  assert.equal(result.title, 'Real Madrid vs Barcelona — La Liga · Round 5')
})

test('different word order keeps both teams and drops the leading context', () => {
  const result = merged('La Liga round 5, tonight 10:30 PM, Real Madrid vs Barcelona')
  assert.equal(result.homeTeamName, 'Real Madrid')
  assert.equal(result.awayTeamName, 'Barcelona')
  assert.equal(result.round, 5)
  assert.equal(result.kickoffDate, TODAY)
  assert.equal(result.kickoffTime, '22:30')
})

// ---------------------------------------------------------------- Bangla
test('Bangla input is understood, including Bangla digits and সাড়ে', () => {
  const result = merged('আজ রাত সাড়ে দশটায় রিয়াল মাদ্রিদ বনাম বার্সেলোনার লা লিগার ৫ম রাউন্ড')
  expectBangla(result.homeTeamName, 'রিয়াল মাদ্রিদ')
  expectBangla(result.awayTeamName, 'বার্সেলোনা')
  assert.equal(result.tournamentName, 'La Liga')
  assert.equal(result.round, 5)
  assert.equal(result.kickoffDate, TODAY)
  assert.equal(result.kickoffTime, '22:30')
})

test('Bangla colon time with Bangla digits becomes a 24-hour value', () => {
  const result = extractExplicitLocalDateTime('আজকে রাত ১০:৩০ মিনিটে ম্যাচ', TODAY)
  assert.equal(result.date, TODAY)
  assert.equal(result.time, '22:30')
})

test('Bangla "৫ নম্বর রাউন্ড" and "পঞ্চম রাউন্ড" both resolve to round 5', () => {
  assert.equal(extractRound('লা লিগার ৫ নম্বর রাউন্ড'), 5)
  assert.equal(extractRound('পঞ্চম রাউন্ডের ম্যাচ'), 5)
})

// ---------------------------------------------------------------- Banglish
test('Banglish input resolves the same match', () => {
  const result = merged('ajke rat 10:30 e real madrid vs barcelona la liga r5')
  assert.equal(result.homeTeamName, 'Real Madrid')
  assert.equal(result.awayTeamName, 'Barcelona')
  assert.equal(result.tournamentName, 'La Liga')
  assert.equal(result.round, 5)
  assert.equal(result.kickoffDate, TODAY)
  assert.equal(result.kickoffTime, '22:30')
})

test('Banglish relative dates are resolved', () => {
  assert.equal(extractExplicitLocalDateTime('kal shokal 9:00 e match', TODAY).date, TOMORROW)
  assert.equal(extractExplicitLocalDateTime('agamikal rat 8:00', TODAY).date, TOMORROW)
  assert.equal(extractExplicitLocalDateTime('gotokal match chilo', TODAY).date, YESTERDAY)
  assert.equal(extractExplicitLocalDateTime('porshu match', TODAY).date, addDays(TODAY, 2))
})

// ---------------------------------------------------------------- mixed
test('mixed Bangla + English input keeps the Latin team names', () => {
  const context = extractMatchContext('আজকে রাত ১০:৩০ minutes e real Madrid vs Barcelonar la ligar round 5 er match ache', TODAY)
  assert.equal(context.teams.homeTeamName, 'real Madrid')
  assert.equal(context.teams.awayTeamName, 'Barcelonar')
  assert.equal(context.competition, 'La Liga')
  assert.equal(context.round, 5)
  assert.equal(context.dateTime.date, TODAY)
  assert.equal(context.dateTime.time, '22:30')
})

test('the database-ready name wins over the literal extracted text when it is known', () => {
  const result = merged(
    'আজকে রাত ১০:৩০ minutes e real Madrid vs Barcelonar la ligar round 5 er match ache',
    {},
    { homeTeam: { id: 'team-1', name: 'Real Madrid', logo: 'sportzone/teams/real-madrid' }, awayTeam: { id: 'team-2', name: 'Barcelona', logo: 'sportzone/teams/barcelona' } },
  )
  assert.equal(result.homeTeamName, 'Real Madrid')
  assert.equal(result.awayTeamName, 'Barcelona')
  assert.equal(result.homeTeamId, 'team-1')
  assert.equal(result.awayTeamId, 'team-2')
  assert.equal(result.homeTeamLogo, 'sportzone/teams/real-madrid')
  assert.equal(result.awayTeamLogo, 'sportzone/teams/barcelona')
  assert.equal(result.confidence.homeTeamName, 'high')
})

// ---------------------------------------------------------------- noisy
test('conversational filler never becomes a team, competition or round', () => {
  const result = merged('ভাই দাঁড়া, আজকে রাত ১০:৩০ এ ওই Real Madrid আর Barcelona এর La Liga round 5 match ta আছে')
  assert.equal(result.homeTeamName, 'Real Madrid')
  assert.equal(result.awayTeamName, 'Barcelona')
  assert.equal(result.tournamentName, 'La Liga')
  assert.equal(result.round, 5)
  assert.equal(result.kickoffTime, '22:30')
})

test('filler-only input produces no invented fields', () => {
  const context = extractMatchContext('ভাই দাঁড়া শোন actually okay hobe', TODAY)
  assert.equal(context.teams.homeTeamName, null)
  assert.equal(context.teams.awayTeamName, null)
  assert.equal(context.competition, null)
  assert.equal(context.round, null)
  assert.equal(context.dateTime.time, null)
})

test('a sport word next to a team name never becomes part of the team name', () => {
  const english = extractExplicitTeams('Bangladesh vs India, cricket, tomorrow at 7:30 PM, Asia Cup')
  assert.equal(english.homeTeamName, 'Bangladesh')
  assert.equal(english.awayTeamName, 'India')

  const bangla = extractExplicitTeams('বাংলাদেশ বনাম ভারত, ক্রিকেট, আগামীকাল রাত ৭:৩০, এশিয়া কাপ')
  expectBangla(bangla.homeTeamName, 'বাংলাদেশ')
  expectBangla(bangla.awayTeamName, 'ভারত')
})

test('a URL is never mistaken for a team name', () => {
  const teams = extractExplicitTeams('watch https://cdn.example.com/live/index.m3u8 right now')
  assert.equal(teams.homeTeamName, null)
  assert.equal(teams.awayTeamName, null)
  assert.equal(isRejectedTeamName('https://cdn.example.com/live.m3u8'), true)
  assert.equal(isRejectedTeamName('ম্যাচ'), true)
  assert.equal(isRejectedTeamName('Real Madrid'), false)
})

// ---------------------------------------------------------------- edge cases
test('a missing round stays unresolved instead of being invented', () => {
  const result = merged('Real Madrid vs Barcelona tonight at 10:30')
  assert.equal(result.round, null)
  assert.equal(result.tournamentName, null)
  assert.equal(result.homeTeamName, 'Real Madrid')
  assert.equal(result.awayTeamName, 'Barcelona')
})

test('a missing time stays unresolved and no default is fabricated', () => {
  const result = merged('Real Madrid vs Barcelona today, La Liga')
  assert.equal(result.kickoffTime, null)
  assert.equal(result.tournamentName, 'La Liga')
  assert.equal(result.kickoffDate, TODAY)
})

test('every required language case yields the same match', () => {
  const inputs = [
    'Real Madrid vs Barcelona La Liga round 5 today 10:30 PM',
    'আজকে রাত ১০:৩০ মিনিটে Real Madrid vs Barcelona La Liga round 5 এর match আছে',
    'ajke rat 10:30 minutes e real Madrid vs Barcelonar la ligar round 5 er match ache',
    'আজ রাত সাড়ে দশটায় রিয়াল মাদ্রিদ আর বার্সেলোনার লা লিগার ৫ নম্বর রাউন্ডের ম্যাচ',
    'real madrid vs barca ajke rat 10:30 la liga r5',
  ]
  for (const input of inputs) {
    const result = merged(input)
    assert.equal(result.tournamentName, 'La Liga', `competition for: ${input}`)
    assert.equal(result.round, 5, `round for: ${input}`)
    assert.equal(result.kickoffDate, TODAY, `date for: ${input}`)
    assert.equal(result.kickoffTime, '22:30', `time for: ${input}`)
  }
})

// ---------------------------------------------------------------- extraction units
test('time formats are normalised to 24-hour HH:mm', () => {
  const cases: Array<[string, string]> = [
    ['match at 10:30 PM', '22:30'],
    ['match at 10.30 pm', '22:30'],
    ['match 22:30', '22:30'],
    ['রাত ১০:৩০ মিনিটে', '22:30'],
    ['রাত 10টা 30', '22:30'],
    ['সাড়ে দশটায়', '22:30'],
    ['সকাল ৯:০০ টায়', '09:00'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(extractExplicitLocalDateTime(input, TODAY).time, expected, `time for: ${input}`)
  }
})

test('round formats resolve and knockout stages stay null', () => {
  assert.equal(extractRound('La Liga round 5'), 5)
  assert.equal(extractRound('Round 5'), 5)
  assert.equal(extractRound('la liga r5'), 5)
  assert.equal(extractRound('matchday 5'), 5)
  assert.equal(extractRound('MD5'), 5)
  assert.equal(extractRound('round five'), 5)
  assert.equal(extractRound('৫ম রাউন্ড'), 5)
  assert.equal(extractRound('Round of 16'), null)
  assert.equal(extractRound('Real Madrid vs Barcelona tonight'), null)
})

test('competition variants resolve to the canonical competition name', () => {
  const cases: Array<[string, string]> = [
    ['La Liga', 'La Liga'],
    ['la liga', 'La Liga'],
    ['LaLiga', 'La Liga'],
    ['লা লিগা', 'La Liga'],
    ['laliga', 'La Liga'],
    ['Spanish league', 'La Liga'],
    ['Spain league', 'La Liga'],
    ['UEFA Champions League', 'UEFA Champions League'],
    ['প্রিমিয়ার লিগ', 'Premier League'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(extractCompetition(input), expected, `competition for: ${input}`)
  }
})

test('URL, quality and sport extraction keep their deterministic guarantees', () => {
  assert.equal(extractStreamUrl('watch https://cdn.example.com/live/index.m3u8 now'), 'https://cdn.example.com/live/index.m3u8')
  assert.equal(extractStreamUrl('no link here'), null)
  assert.equal(extractExplicitQuality('quality 720p stream'), '720p')
  assert.equal(extractExplicitQuality('https://cdn.example.com/1080p/index.m3u8'), '1080p')
  assert.equal(extractExplicitSport('cricket match'), 'CRICKET')
  assert.equal(extractExplicitSport('ফুটবল ম্যাচ'), 'FOOTBALL')
  assert.equal(extractExplicitSport('basketball game'), 'BASKETBALL')
  assert.equal(extractExplicitSport('unknown sport'), null)
  assert.equal(getSportDuration('FOOTBALL'), 120)
  assert.equal(getSportDuration('CRICKET'), 240)
  assert.equal(getSportDuration(null), null)
})

test('unmatched team names are formatted without damaging official capitalisation', () => {
  assert.equal(formatTeamName('real madrid'), 'Real Madrid')
  assert.equal(formatTeamName('barcelona'), 'Barcelona')
  assert.equal(formatTeamName('manchester city'), 'Manchester City')
  assert.equal(formatTeamName('liverpool'), 'Liverpool')
  assert.equal(formatTeamName('PSG'), 'PSG')
  assert.equal(formatTeamName('Inter Miami'), 'Inter Miami')
  assert.equal(formatTeamName('LA Galaxy'), 'LA Galaxy')
  assert.equal(formatTeamName('RB Leipzig'), 'RB Leipzig')
  assert.equal(formatTeamName('FC Porto'), 'FC Porto')
  assert.equal(formatTeamName('AC Milan'), 'AC Milan')
  assert.equal(formatTeamName('fc porto'), 'FC Porto')
  assert.equal(formatTeamName('ac milan'), 'AC Milan')
})

// ---------------------------------------------------------------- merge rules
test('the deterministic time is never overwritten by the model', () => {
  const result = merged('Real Madrid vs Barcelona today at 10:30 PM', { kickoffDate: TODAY, kickoffTime: '22:00' })
  assert.equal(result.kickoffTime, '22:30')
})

test('the model fills the fields the deterministic layer cannot read', () => {
  const result = merged('Real Madrid vs Barcelona', {
    homeTeamName: 'Real Madrid',
    awayTeamName: 'Barcelona',
    tournamentName: 'La Liga',
    sport: 'FOOTBALL',
    kickoffDate: TOMORROW,
    kickoffTime: '20:00',
  })
  assert.equal(result.homeTeamName, 'Real Madrid')
  assert.equal(result.awayTeamName, 'Barcelona')
  assert.equal(result.tournamentName, 'La Liga')
  assert.equal(result.sport, 'FOOTBALL')
  assert.equal(result.expectedDurationMinutes, 120)
  assert.equal(result.kickoffDate, TOMORROW)
  assert.equal(result.kickoffTime, '20:00')
})

test('a sport the match table cannot store is rejected with a warning', () => {
  const result = merged('Lakers vs Celtics basketball', { sport: 'BASKETBALL' })
  assert.equal(result.sport, null)
  assert.ok(result.warnings.some((warning) => warning.includes('Basketball')))
})

test('the same team on both sides is never applied', () => {
  const result = merged('Real Madrid vs Real Madrid', { homeTeamName: 'Real Madrid', awayTeamName: 'Real Madrid' })
  assert.equal(result.homeTeamName, null)
  assert.equal(result.awayTeamName, null)
  assert.ok(result.warnings.some((warning) => warning.includes('same team name')))
})

test('an unmatched team keeps the extracted name and no invented logo or id', () => {
  const context = extractMatchContext('মোহামেডান বনাম আবাহনী আজ রাত ৭টায়', TODAY)
  const result = mergeMatchExtraction({
    aiResult: emptyAiResult(),
    context,
    homeTeam: null,
    awayTeam: null,
    timezone: 'Asia/Dhaka',
  })
  expectBangla(result.homeTeamName, 'মোহামেডান')
  expectBangla(result.awayTeamName, 'আবাহনী')
  assert.equal(result.homeTeamId, null)
  assert.equal(result.awayTeamId, null)
  assert.equal(result.homeTeamLogo, null)
  assert.ok(result.warnings.some((warning) => warning.includes('logos')))
})

test('the model is never asked for a logo or a team id', () => {
  const result = merged('Real Madrid vs Barcelona', { homeTeamLogo: 'https://example.com/logo.png', homeTeamId: null })
  assert.equal(result.homeTeamLogo, null)
  assert.equal(result.homeTeamId, null)
})

test('warnings stay within the response schema limit', () => {
  const result = merged('Real Madrid vs Real Madrid', { sport: 'TENNIS', warnings: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })
  assert.ok(result.warnings.length <= 8)
  assert.doesNotThrow(() => matchParseResultSchema.parse(result))
})
