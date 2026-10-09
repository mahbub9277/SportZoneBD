import type { MatchParseResult } from './description.validator.js'

/**
 * Deterministic (non-AI) match understanding.
 *
 * This layer is intentionally free of Prisma and Gemini so it can be unit tested, and it stays
 * authoritative for what the brief calls "obvious": explicit URLs, clearly written dates and times,
 * explicit quality, and exact known competition/round patterns. Everything that needs semantic
 * understanding (Bangla/Banglish phrasing, informal wording, word order) is delegated to Gemini and
 * merged on top of these results by `mergeMatchExtraction`.
 *
 * Three Unicode details drive the shape of this file:
 *  - NFC does *not* compose Bengali ড়/ঢ়/য় (they are Unicode composition exclusions), so text typed
 *    with a separate nukta would never compare equal to text typed with the precomposed letter.
 *    `normalizeBangla` maps both spellings onto one form.
 *  - Bengali combining marks (matras, nukta, hasanta) are `\p{M}`, not `\p{L}`, so author/vowel-strip
 *    patterns must list `\p{M}` explicitly or they silently mangle names ("আবাহনী" → "আবাহন").
 *  - `\b` never matches around non-ASCII letters, so every word pattern uses letter/mark lookarounds.
 */

/** Match sports the database can store (`SportType` in prisma/schema.prisma). */
export const SUPPORTED_MATCH_SPORTS: ReadonlyArray<NonNullable<MatchParseResult['sport']>> = ['CRICKET', 'FOOTBALL', 'MOTORSPORTS', 'WWE']

/** Sports the model may report but the match table cannot store. */
const UNSUPPORTED_SPORTS: ReadonlyArray<{ sport: NonNullable<MatchParseResult['sport']>; label: string }> = [
  { sport: 'BASKETBALL', label: 'Basketball' },
  { sport: 'TENNIS', label: 'Tennis' },
]

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯'

/** Precomposed forms for the Bengali letters that NFC refuses to compose. */
const NUKTA_LETTERS: Array<[RegExp, string]> = [
  [/\u09A1\u09BC/g, '\u09DC'],
  [/\u09A2\u09BC/g, '\u09DD'],
  [/\u09AF\u09BC/g, '\u09DF'],
]

export function normalizeBangla(value: string): string {
  let result = value.normalize('NFC')
  for (const [nuktaPattern, precomposed] of NUKTA_LETTERS) result = result.replace(nuktaPattern, precomposed)
  return result
}

/** Normalised Unicode + ASCII digits: every pattern below can then treat Bangla input like Latin input. */
function prepare(value: string): string {
  return normalizeBangla(value).replace(/[\u09E6-\u09EF]/g, (character) => String(BANGLA_DIGITS.indexOf(character)))
}

export function normalizeDigits(input: string): string {
  return prepare(input)
}

/** Unicode-aware pattern: `\b` is unusable around non-ASCII letters. */
function pattern(source: string, flags = 'i'): RegExp {
  return new RegExp(normalizeBangla(source), flags.includes('u') ? flags : `${flags}u`)
}

/** Whole-word term alternation. */
function terms(values: string[]): string {
  return `(?<![\\p{L}\\p{M}\\p{N}])(?:${values.map(normalizeBangla).join('|')})(?![\\p{L}\\p{M}\\p{N}])`
}

/** Term alternation for positions that are already constrained by the surrounding pattern. */
function unitTerms(values: string[]): string {
  return `(?:${values.map(normalizeBangla).join('|')})`
}

/** Bengali/Latin genitive particle glued to a phrase ("লিগা" + "র", "liga" + "r"). */
const PARTICLE_SUFFIX = '(?:[\\u09BE-\\u09CD]?[\\u09B0r]|[\\u098F\\u09C7][\\u09B0r])'

/** Term alternation that tolerates a trailing genitive particle. */
function phraseTerms(values: string[]): string {
  return `(?<![\\p{L}\\p{M}\\p{N}])(?:${values.map(normalizeBangla).join('|')})${PARTICLE_SUFFIX}?(?![\\p{L}\\p{M}\\p{N}])`
}

const DATE_WORDS = ['today', 'tonight', 'tomorrow', 'yesterday', 'আজকে', 'আজ', 'আগামীকাল', 'গতকাল', 'কাল', 'পরশু', 'ajke', 'aj', 'aaj', 'agamikal', 'gotokal', 'kalke', 'kal', 'porshu', 'porsu']
const TIME_QUALIFIERS = ['রাত', 'রাতে', 'সকাল', 'সকালে', 'ভোর', 'দুপুর', 'দুপুরে', 'বিকাল', 'বিকালে', 'বিকেলে', 'সন্ধ্যা', 'সন্ধ্যায়', 'সন্ধায়', 'টায়', 'টার', 'টা', 'rat', 'raat', 'sokal', 'shokal', 'sokale', 'dupur', 'dupore', 'bikal', 'bikale', 'sondha', 'sondhae', 'night', 'morning', 'evening', 'afternoon']
const TIME_UNITS = ['am', 'pm', 'মিনিটে', 'মিনিট', 'minutes', 'minute', 'min', 'baje', 'বাজে', 'ta', 'te', 'tay', 'on']
const TIME_UNIT_WORDS = ['টা', 'টায়', 'টার', 'টাই', 'ta', 'te', 'tay', 'baje', 'বাজে']
const HALF_PAST = ['সাড়ে', 'সারে', 'sare', 'sade']
const ROUND_WORDS = ['round', 'rounds', 'matchday', 'match day', 'ম্যাচডে', 'রাউন্ড', 'রাউন্ডে', 'রাউন্ডের', 'নম্বর', 'তম', 'নং', 'md', 'rd']
const MATCH_WORDS = ['match', 'matches', 'game', 'games', 'fixture', 'fixtures', 'ম্যাচ', 'ম্যাচটা', 'ম্যাচটি', 'খেলা', 'vs', 'versus', 'against', 'বনাম', 'bonam', 'আর', 'এবং', 'and', '&']
const FILLER_WORDS = ['দাঁড়া', 'দাড়া', 'ও মা', 'ওমা', 'আরে', 'ভাই', 'মানে', 'এই যে', 'শোন', 'ওই', 'হুম', 'আচ্ছা', 'achhe', 'actually', 'okay', 'ok', 'hmm', 'please', 'plz', 'daara', 'dara', 'oi', 'mane', 'vai', 'bhai', 'ache', 'hobe']
const PARTICLE_WORDS = ['এর', 'ের', 'এ', 'তে', 'র', 'েরে', 'of', 'in', 'at', 'for', 'the', 'er', 'e', 'ta', 'o']
const COMPETITION_WORDS = [
  'league', 'leagues', 'cup', 'competition', 'tournament', 'liga', 'ligar', 'লিগা', 'লিগার', 'লিগ', 'চ্যাম্পিয়নস', 'চ্যাম্পিয়ন',
  'প্রিমিয়ার', 'লা', 'বুন্দেসলিগা', 'সিরি', 'কোপা', 'আমেরিকা', 'বিশ্বকাপ', 'ওয়ার্ল্ড', 'কাপ', 'প্রীতি', 'qualifier', 'qualifiers',
  'premier', 'serie', 'bundesliga', 'fifa', 'uefa', 'ucl', 'world', 'copa', 'friendly',
]
const STREAM_WORDS = ['stream', 'streaming', 'quality', 'kick-off', 'kickoff', 'live', 'hd', 'sd', 'fhd', '4k']
/** Connector words that belong to a competition name only when they sit next to one. */
const CONNECTOR_WORDS = ['la', 'le', 'el', 'a', 'de', 'del', 'the', 'of']

const SPORT_TERMS: Array<[string[], NonNullable<MatchParseResult['sport']>]> = [
  [['football', 'soccer', 'ফুটবল', 'futbol'], 'FOOTBALL'],
  [['cricket', 'ক্রিকেট', 'ক্রিকেটার'], 'CRICKET'],
  [['motorsport', 'motor sport', 'formula 1', 'f1', 'রেসিং'], 'MOTORSPORTS'],
  [['wwe', 'wrestling', 'রেসলিং'], 'WWE'],
  [['basketball', 'বাস্কেটবল'], 'BASKETBALL'],
  [['tennis', 'টেনিস'], 'TENNIS'],
]

const COMPETITIONS: Array<[string[], string]> = [
  [['ucl', 'uefa champions league', 'uefa champion league', 'চ্যাম্পিয়নস লিগ', 'চ্যাম্পিয়ন্স লিগ'], 'UEFA Champions League'],
  [['premier league', 'premier lig', 'প্রিমিয়ার লিগ', 'প্রিমিয়ার লিগার'], 'Premier League'],
  [['la liga', 'laliga', 'la ligar', 'লা লিগা', 'লালিগা'], 'La Liga'],
  [['spanish league', 'spain league', 'spanish la liga'], 'La Liga'],
  [['bundesliga', 'বুন্দেসলিগা'], 'Bundesliga'],
  [['serie a', 'সিরি আ'], 'Serie A'],
  [['fifa world cup'], 'FIFA World Cup'],
  [['world cup qualifier', 'world cup qualifiers'], 'World Cup Qualifier'],
  [['world cup', 'বিশ্বকাপ', 'ওয়ার্ল্ড কাপ'], 'World Cup'],
  [['copa america', 'copa américa', 'কোপা আমেরিকা'], 'Copa América'],
  [['international friendly', 'international friendlies', 'প্রীতি ম্যাচ'], 'International Friendly'],
]

/** Cardinal/ordinal words (Bangla, Banglish and English) that can stand next to "round". */
const ROUND_NUMBER_WORDS: Record<string, number> = normalizeNumberKeys({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  ek: 1, dui: 2, tin: 3, char: 4, panch: 5, pach: 5, choy: 6, sat: 7, aat: 8, noy: 9, dosh: 10,
  'প্রথম': 1, 'দ্বিতীয়': 2, 'তৃতীয়': 3, 'চতুর্থ': 4, 'পঞ্চম': 5, 'ষষ্ঠ': 6, 'সপ্তম': 7, 'অষ্টম': 8, 'নবম': 9, 'দশম': 10,
})

const BANGLA_HOUR_WORDS: Record<string, number> = normalizeNumberKeys({
  'এক': 1, 'দুই': 2, 'তিন': 3, 'চার': 4, 'পাঁচ': 5, 'ছয়': 6, 'সাত': 7, 'আট': 8, 'নয়': 9, 'দশ': 10, 'এগারো': 11, 'বারো': 12,
})

function normalizeNumberKeys(source: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(source)) result[normalizeBangla(key).toLowerCase()] = value
  return result
}

/** Sport words are noise for team extraction: "Bangladesh vs India, cricket" must not yield "India cricket". */
const SPORT_WORDS = SPORT_TERMS.flatMap(([values]) => values)

const NOISE_TOKENS = new Set([
  ...DATE_WORDS, ...TIME_QUALIFIERS, ...TIME_UNITS, ...TIME_UNIT_WORDS, ...HALF_PAST, ...ROUND_WORDS, ...MATCH_WORDS,
  ...FILLER_WORDS, ...PARTICLE_WORDS, ...COMPETITION_WORDS, ...STREAM_WORDS, ...SPORT_WORDS,
].map((value) => normalizeBangla(value).toLowerCase()))

const ROUND_NUMBER_TOKENS = new Set(Object.keys(ROUND_NUMBER_WORDS))
const COMPETITION_TOKENS = new Set(COMPETITION_WORDS.map((value) => normalizeBangla(value).toLowerCase()))
const CONNECTOR_TOKENS = new Set(CONNECTOR_WORDS.map((value) => normalizeBangla(value).toLowerCase()))
const ROUTE_WORDS = ROUND_WORDS.map((value) => normalizeBangla(value).toLowerCase())
const TIME_UNIT_SUFFIX = new RegExp(`${unitTerms(TIME_UNIT_WORDS)}$`, 'u')
/** Bengali ordinal suffix after a numeral: ম / তম / নম্বর / নং. */
const BANGLA_ORDINAL_SUFFIX = '(?:\\u09AE|\\u09A4\\u09AE|\\u09A8\\u09AE\\u09CD\\u09AC\\u09B0|\\u09A8\\u0982)'

export function extractStreamUrl(input: string): string | null {
  const candidate = input.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;]+$/, '')
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return candidate
  } catch {
    return null
  }
}

export function extractExplicitQuality(input: string): string | null {
  const match = prepare(input).match(/(?:quality\s*[:=]?\s*)?(\d{3,4}p|4k)(?![\p{L}\p{N}])/iu)
  return match?.[1]?.toLowerCase() ?? null
}

export function extractExplicitSport(input: string): MatchParseResult['sport'] {
  const value = prepare(input)
  for (const [values, sport] of SPORT_TERMS) {
    if (pattern(terms(values)).test(value)) return sport
  }
  return null
}

// ---------------------------------------------------------------- teams

function tokenize(segment: string): string[] {
  return prepare(segment)
    .replace(/https?:\/\/[^\s<>"']+/gi, ' ')
    .split(/[\s,;|()[\]{}"']+/u)
    .map((token) => token.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, ''))
    .filter(Boolean)
}

/**
 * Bengali genitive glued to the end of a name. Only the particle itself is removed, because the
 * vowel sign can belong to the name: "বার্সেলোনা" + "র" must stay "বার্সেলোনা", while
 * "মাদ্রিদ" + "ের" must become "মাদ্রিদ".
 */
const GENITIVE_SUFFIX = new RegExp(`(?:[\\u098F\\u09C7]\\u09B0|(?<=[\\u09BE-\\u09CC])\\u09B0)$`, 'u')

function stripGenitive(value: string): string {
  const trimmed = value.trim()
  const withoutGenitive = trimmed.replace(GENITIVE_SUFFIX, '').trim()
  return withoutGenitive !== trimmed && withoutGenitive.length >= 3 ? withoutGenitive : trimmed
}

function isTimeWordToken(value: string): boolean {
  const bare = value.replace(TIME_UNIT_SUFFIX, '')
  if (bare === value || !bare) return false
  if (BANGLA_HOUR_WORDS[bare] !== undefined) return true
  if (ROUND_NUMBER_WORDS[bare] !== undefined) return true
  return /^\d{1,2}$/.test(bare)
}

function isCompetitionToken(value: string): boolean {
  if (COMPETITION_TOKENS.has(value)) return true
  const banglaStripped = stripGenitive(value)
  if (banglaStripped !== value && COMPETITION_TOKENS.has(banglaStripped)) return true
  const latinStripped = value.replace(/(?:er|es|s|r)$/u, '')
  return latinStripped !== value && COMPETITION_TOKENS.has(latinStripped)
}

/** True for tokens that describe *when*, *which round*, *which competition* or filler rather than a team. */
function isNoiseToken(token: string, previous: string | undefined, next: string | undefined): boolean {
  const value = normalizeBangla(token).toLowerCase()
  if (NOISE_TOKENS.has(value)) return true
  if (/^\d/.test(value)) return true
  if (/^\d+(?:\u09AE|\u09A4\u09AE|\u09A8\u09AE\u09CD\u09AC\u09B0)?$/u.test(value)) return true
  if (ROUND_NUMBER_TOKENS.has(value) && value.length <= 8) return true
  if (ROUTE_WORDS.some((word) => value.includes(word))) return true
  if (isCompetitionToken(value)) return true
  if (isTimeWordToken(value)) return true
  if (CONNECTOR_TOKENS.has(value)
    && ((next !== undefined && isCompetitionToken(next)) || (previous !== undefined && isCompetitionToken(previous)))) {
    return true
  }
  return false
}

/** True when a value cannot be a team: filler-only, a URL, a number, or unreasonable. */
export function isRejectedTeamName(value: string | null | undefined): boolean {
  if (!value) return true
  const candidate = value.trim()
  if (candidate.length < 2 || candidate.length > 80) return true
  if (/^https?:\/\//i.test(candidate) || /www\./i.test(candidate)) return true
  if (!/[\p{L}]/u.test(candidate)) return true
  if (/^\d{1,4}(?::\d{2})?$/.test(candidate)) return true
  const lowered = normalizeBangla(candidate).toLowerCase()
  if (FILLER_WORDS.some((filler) => lowered === normalizeBangla(filler).toLowerCase())) return true
  if (MATCH_WORDS.some((word) => lowered === normalizeBangla(word).toLowerCase())) return true
  if (candidate.split(/\s+/).length > 6) return true
  return false
}

/**
 * A team sits next to the separator, so the cleaning drops the words that describe time, round,
 * competition, streaming or filler and keeps the run of remaining words closest to "vs".
 */
function extractTeamRun(segment: string, side: 'home' | 'away'): string {
  const tokens = tokenize(segment)
  const classified = tokens.map((token, index) => ({
    token,
    noise: isNoiseToken(
      token,
      index > 0 ? normalizeBangla(tokens[index - 1]).toLowerCase() : undefined,
      index + 1 < tokens.length ? normalizeBangla(tokens[index + 1]).toLowerCase() : undefined,
    ),
  }))

  const runs: string[][] = []
  for (const { token, noise } of classified) {
    if (noise) {
      runs.push([])
      continue
    }
    if (runs.length === 0) runs.push([])
    runs[runs.length - 1].push(token)
  }

  const usableRuns = runs.filter((run) => run.length > 0 && !isRejectedTeamName(run.join(' ')))
  if (usableRuns.length === 0) return ''
  const chosen = side === 'home' ? usableRuns[usableRuns.length - 1] : usableRuns[0]
  return stripGenitive(chosen.join(' '))
}

export function extractExplicitTeams(input: string): { homeTeamName: string | null; awayTeamName: string | null; title: string | null } {
  const withoutUrl = input.replace(/https?:\/\/[^\s<>"']+/gi, ' ').replace(/\s+/g, ' ').trim()
  const match = withoutUrl.match(/(.+?)\s+(?:vs\.?|versus|against|v\.|বনাম|bonam)\s+(.+)/i)
    ?? withoutUrl.match(/(.+?)\s+(?:আর|এবং|and|&)\s+(.+)/i)
  if (!match) return { homeTeamName: null, awayTeamName: null, title: null }

  const homeTeamName = extractTeamRun(match[1], 'home')
  const awayTeamName = extractTeamRun(match[2], 'away')
  if (isRejectedTeamName(homeTeamName) || isRejectedTeamName(awayTeamName)) {
    return { homeTeamName: null, awayTeamName: null, title: null }
  }
  return { homeTeamName, awayTeamName, title: `${homeTeamName} vs ${awayTeamName}` }
}

/**
 * Formats a team name that was *not* found in the database. Names that already carry meaningful
 * capitalisation (Inter Miami, LA Galaxy, PSG, FC Porto) are returned untouched, because "improving"
 * them risks damaging official names.
 */
export function formatTeamName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name) return name
  if (/[A-Z]/.test(name)) return name
  if (name.length <= 4) return name.toUpperCase()

  const keepUpper = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'cfc', 'rb', 'la', 'cd', 'ud', 'sv', 'as', 'bk', 'kc', 'ss'])
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (keepUpper.has(word)) return word.toUpperCase()
      if (/^\d+$/.test(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

export function extractCompetition(input: string): string | null {
  const value = prepare(input)
  for (const [values, canonical] of COMPETITIONS) {
    if (pattern(phraseTerms(values)).test(value)) return canonical
  }
  return null
}

function clampRound(value: number): number | null {
  if (!Number.isInteger(value) || value < 1 || value > 200) return null
  return value
}

/**
 * Round / matchday is numeric only: knockout labels such as "Round of 16" describe a stage rather
 * than a matchday and are left to the competition wording.
 */
export function extractRound(input: string): number | null {
  const value = prepare(input)
  if (pattern(terms(['round of 16', 'round of 32', 'round of 64', 'round of 128'])).test(value)) return null

  const roundWord = unitTerms(ROUND_WORDS)
  const digitAfter = value.match(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${roundWord}[\\s\\-:#]*(\\d{1,3})(?!\\d)`, 'iu'))
  if (digitAfter) return clampRound(Number(digitAfter[1]))

  const digitBefore = value.match(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(\\d{1,3})(?!\\d)\\s*${BANGLA_ORDINAL_SUFFIX}?\\s*${roundWord}`, 'iu'))
  if (digitBefore) return clampRound(Number(digitBefore[1]))

  const shortForm = value.match(/(?<![\p{L}\p{N}])(?:r|rd|md)\s*(\d{1,3})(?!\d)/iu)
  if (shortForm) return clampRound(Number(shortForm[1]))

  const wordAfter = value.match(new RegExp(`${roundWord}\\s+([\\p{L}\\p{M}]+)`, 'iu'))?.[1]
  const afterValue = wordAfter ? ROUND_NUMBER_WORDS[normalizeBangla(wordAfter).toLowerCase()] : undefined
  if (typeof afterValue === 'number') return clampRound(afterValue)

  const wordBefore = value.match(new RegExp(`([\\p{L}\\p{M}]+)\\s*${roundWord}`, 'u'))?.[1]
  const beforeValue = wordBefore ? ROUND_NUMBER_WORDS[normalizeBangla(wordBefore).toLowerCase()] : undefined
  if (typeof beforeValue === 'number') return clampRound(beforeValue)

  return null
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function resolveHour(hour: number, options: { isNight: boolean; isMorning: boolean; isEvening: boolean; suffix: string }): number {
  if (options.suffix === 'pm' && hour < 12) return hour + 12
  if (options.suffix === 'am' && hour === 12) return 0
  if (options.isNight && hour < 12) return hour + 12
  if (options.isMorning && hour >= 12) return hour - 12
  if (options.isEvening && hour < 12) return hour + 12
  return hour
}

/**
 * Bangla match talk names hours informally ("দশটা" is 22:00), so a bare Bangla hour word is read as
 * an evening kick-off unless the sentence says morning. Digit times stay literal.
 */
function resolveInformalHour(hour: number, options: { isMorning: boolean }): number {
  if (options.isMorning) return hour % 12
  return hour < 12 ? hour + 12 : hour
}

function resolveHourWord(word: string | undefined): number | null {
  if (!word) return null
  const bare = normalizeBangla(word).replace(TIME_UNIT_SUFFIX, '').trim().toLowerCase()
  const value = BANGLA_HOUR_WORDS[bare] ?? ROUND_NUMBER_WORDS[bare]
  return typeof value === 'number' ? value : null
}

function formatTime(hour: number, minute: number): string | null {
  if (hour > 23 || minute > 59 || hour < 0 || minute < 0) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Reads "10:30", "10.30 pm", "২২:৩০", "রাত ১০:৩০", "সাড়ে দশটা", "১০টা ৩০" and "সন্ধ্যায় ৭টা" as a
 * 24-hour time. Deterministic values win over the model's interpretation, so this stays strict:
 * anything it cannot read returns null and is left for human review.
 */
function extractTime(input: string): string | null {
  const value = prepare(input)
  const isNight = pattern(terms(['রাত', 'রাতে', 'tonight', 'night', 'rat', 'raat'])).test(value)
  const isMorning = pattern(terms(['সকাল', 'সকালে', 'ভোর', 'sokal', 'shokal', 'sokale', 'morning'])).test(value)
  const isEvening = pattern(terms(['সন্ধ্যা', 'সন্ধ্যায়', 'সন্ধায়', 'বিকাল', 'বিকালে', 'সন্ধায়', 'sondha', 'sondhae', 'bikal', 'bikale', 'evening'])).test(value)
  const flags = { isNight, isMorning, isEvening, suffix: '' }

  const clock = value.match(/(?<![\d:])(\d{1,2})\s*[:.]\s*(\d{2})(?!\d)\s*(am|pm)?/i)
  if (clock) {
    const suffix = (clock[3] ?? '').toLowerCase()
    return formatTime(resolveHour(Number(clock[1]), { ...flags, suffix }), Number(clock[2]))
  }

  const minutesAfterUnit = value.match(new RegExp(`(\\d{1,2})\\s*${unitTerms(TIME_UNIT_WORDS)}\\s*(\\d{1,2})(?!\\d)`, 'iu'))
  if (minutesAfterUnit) {
    return formatTime(resolveHour(Number(minutesAfterUnit[1]), flags), Number(minutesAfterUnit[2]))
  }

  const halfPast = value.match(new RegExp(`(?:${HALF_PAST.map(normalizeBangla).join('|')})\\s*([\\p{L}\\p{M}]+)`, 'iu'))
  if (halfPast) {
    const hour = resolveHourWord(halfPast[1])
    if (hour !== null) return formatTime(resolveInformalHour(hour, flags), 30)
  }

  const wordHour = value.match(new RegExp(`([\\p{L}\\p{M}]+)\\s*${unitTerms(TIME_UNIT_WORDS)}(?![\\p{L}\\p{N}])`, 'iu'))
  if (wordHour) {
    const hour = resolveHourWord(wordHour[1])
    if (hour !== null) return formatTime(resolveInformalHour(hour, flags), 0)
  }

  const digitHour = value.match(new RegExp(`(?<![\\d:])(\\d{1,2})\\s*${unitTerms(TIME_UNIT_WORDS)}(?![\\p{L}\\p{N}])`, 'iu'))
  if (digitHour) {
    return formatTime(resolveHour(Number(digitHour[1]), flags), 0)
  }

  const qualifier = value.match(new RegExp(`${terms(TIME_QUALIFIERS)}[\\s,]*(\\d{1,2})(?!\\d)\\s*(am|pm)?`, 'iu'))
  if (qualifier) {
    const suffix = (qualifier[2] ?? '').toLowerCase()
    const time = formatTime(resolveHour(Number(qualifier[1]), { ...flags, suffix }), 0)
    if (time) return time
  }

  const suffixOnly = value.match(/(?<![\d:])(\d{1,2})\s*(am|pm)(?![\p{L}\p{N}])/iu)
  if (suffixOnly) {
    const suffix = suffixOnly[2].toLowerCase()
    return formatTime(resolveHour(Number(suffixOnly[1]), { ...flags, suffix }), 0)
  }

  return null
}

export function extractExplicitLocalDateTime(input: string, currentDate: string): { date: string | null; time: string | null } {
  const value = prepare(input)
  const hasYesterday = pattern(terms(['yesterday', 'গতকাল', 'gotokal'])).test(value)
  const hasDayAfterTomorrow = pattern(terms(['পরশু', 'porshu', 'porsu'])).test(value)
  const hasTomorrow = pattern(terms(['tomorrow', 'আগামীকাল', 'কাল', 'agamikal', 'kalke', 'kal'])).test(value)
  const hasToday = pattern(terms(['today', 'tonight', 'আজকে', 'আজ', 'ajke', 'aj', 'aaj'])).test(value)

  const date = hasYesterday
    ? addDays(currentDate, -1)
    : hasDayAfterTomorrow
      ? addDays(currentDate, 2)
      : hasTomorrow
        ? addDays(currentDate, 1)
        : hasToday
          ? currentDate
          : null

  return { date, time: extractTime(input) }
}

export function getSportDuration(sport: MatchParseResult['sport']): number | null {
  if (sport === 'FOOTBALL') return 120
  if (sport === 'CRICKET') return 240
  return null
}

export function isValidLocalDateTime(date: string | null, time: string | null): boolean {
  if (!date || !time) return true
  const parsed = new Date(`${date}T${time}:00Z`)
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === date
    && parsed.toISOString().slice(11, 16) === time
}

export interface ExtractedMatchContext {
  url: string | null
  quality: string | null
  sport: MatchParseResult['sport']
  teams: ReturnType<typeof extractExplicitTeams>
  competition: string | null
  round: number | null
  dateTime: { date: string | null; time: string | null }
}

export function extractMatchContext(input: string, currentDate: string): ExtractedMatchContext {
  return {
    url: extractStreamUrl(input),
    quality: extractExplicitQuality(input),
    sport: extractExplicitSport(input),
    teams: extractExplicitTeams(input),
    competition: extractCompetition(input),
    round: extractRound(input),
    dateTime: extractExplicitLocalDateTime(input, currentDate),
  }
}

export interface ResolvedTeam {
  id: string | null
  name: string
  logo: string | null
}

export interface MergeMatchOptions {
  /** Result the model returned, already validated by `matchParseResultSchema`. */
  aiResult: MatchParseResult
  context: ExtractedMatchContext
  /** Department-scoped team resolved from an existing `Team` row. */
  homeTeam: ResolvedTeam | null
  awayTeam: ResolvedTeam | null
  /** Logo recovered from a previously saved match with the same team name, when no team row matched. */
  homeLegacyLogo?: string | null
  awayLegacyLogo?: string | null
  timezone: string
}

/**
 * Merges the deterministic extraction with the model's interpretation.
 *
 * Priority follows the project rule: explicit deterministic values win for URLs, quality, sport,
 * date/time and round. Team identity prefers the name the database recognised (canonical name, logo
 * and id), then the model's wording, and finally the literal extracted text.
 */
export function mergeMatchExtraction({
  aiResult,
  context,
  homeTeam,
  awayTeam,
  homeLegacyLogo = null,
  awayLegacyLogo = null,
  timezone,
}: MergeMatchOptions): MatchParseResult {
  const warnings = [...aiResult.warnings]
  const explicitSport = context.sport
  const candidateSport = explicitSport ?? aiResult.sport
  const unsupported = UNSUPPORTED_SPORTS.find((entry) => entry.sport === candidateSport)
  const sport = candidateSport && SUPPORTED_MATCH_SPORTS.includes(candidateSport) ? candidateSport : null
  if (unsupported) warnings.push(`${unsupported.label} is not a selectable match sport; choose one before saving.`)

  const aiHome = aiResult.homeTeamName && !isRejectedTeamName(aiResult.homeTeamName) ? aiResult.homeTeamName : null
  const aiAway = aiResult.awayTeamName && !isRejectedTeamName(aiResult.awayTeamName) ? aiResult.awayTeamName : null

  const home = homeTeam
    ?? (aiHome ? { id: null, name: formatTeamName(aiHome), logo: null } : null)
    ?? (context.teams.homeTeamName ? { id: null, name: formatTeamName(context.teams.homeTeamName), logo: null } : null)
  const away = awayTeam
    ?? (aiAway ? { id: null, name: formatTeamName(aiAway), logo: null } : null)
    ?? (context.teams.awayTeamName ? { id: null, name: formatTeamName(context.teams.awayTeamName), logo: null } : null)

  const sameTeams = Boolean(home && away && home.name.toLowerCase() === away.name.toLowerCase())
  const homeName = sameTeams ? null : (home?.name ?? null)
  const awayName = sameTeams ? null : (away?.name ?? null)
  const homeLogo = sameTeams ? null : (home?.logo ?? homeLegacyLogo ?? null)
  const awayLogo = sameTeams ? null : (away?.logo ?? awayLegacyLogo ?? null)

  const competition = context.competition ?? aiResult.tournamentName
  const round = context.round ?? aiResult.round ?? null
  const date = context.dateTime.date ?? (isValidLocalDateTime(aiResult.kickoffDate, aiResult.kickoffTime) ? aiResult.kickoffDate : null)
  const time = context.dateTime.time ?? (isValidLocalDateTime(aiResult.kickoffDate, aiResult.kickoffTime) ? aiResult.kickoffTime : null)
  const duration = aiResult.expectedDurationMinutes ?? getSportDuration(sport)

  if (round !== null) warnings.push(`Round ${round} was detected and added to the match title; the match table has no round column.`)
  if (sameTeams && home) warnings.push('The same team name was detected on both sides; review the teams.')
  if (!homeName || !awayName) warnings.push('Add both team names in the Teams section for the best card display.')
  if ((homeName && !homeLogo) || (awayName && !awayLogo)) warnings.push('One or more team logos were not found in existing team data; upload only if needed.')

  return {
    title: buildMatchTitle(homeName, awayName, competition, round, aiResult.title),
    tournamentName: competition,
    sport,
    homeTeamName: homeName,
    awayTeamName: awayName,
    homeTeamId: sameTeams ? null : (home?.id ?? null),
    awayTeamId: sameTeams ? null : (away?.id ?? null),
    homeTeamLogo: homeLogo,
    awayTeamLogo: awayLogo,
    round,
    timezone,
    kickoffDate: date,
    kickoffTime: time,
    expectedDurationMinutes: duration,
    autoFinish: aiResult.autoFinish,
    preStartEnabled: aiResult.preStartEnabled,
    preStartWindowMinutes: aiResult.preStartWindowMinutes,
    primaryStreamUrl: context.url,
    quality: context.quality,
    // The one-line summary is composed where the merged values are known, after this function returns.
    description: null,
    confidence: {
      ...aiResult.confidence,
      ...(home ? { homeTeamName: home.id ? 'high' as const : aiResult.confidence.homeTeamName ?? 'medium' } : {}),
      ...(away ? { awayTeamName: away.id ? 'high' as const : aiResult.confidence.awayTeamName ?? 'medium' } : {}),
      ...(sameTeams ? {} : { homeTeamId: home?.id ? 'high' as const : 'low' as const, awayTeamId: away?.id ? 'high' as const : 'low' as const }),
      ...(homeLogo ? { homeTeamLogo: 'high' as const } : {}),
      ...(awayLogo ? { awayTeamLogo: 'high' as const } : {}),
      ...(competition ? { title: 'high' as const, tournamentName: 'high' as const } : {}),
      ...(round !== null ? { round: 'high' as const } : {}),
      sport: sport ? (explicitSport ? 'high' as const : aiResult.confidence.sport ?? 'medium') : 'low' as const,
      ...(date ? { kickoffDate: 'high' as const } : { kickoffDate: 'low' as const }),
      ...(time ? { kickoffTime: 'high' as const } : { kickoffTime: 'low' as const }),
      ...(context.quality ? { quality: 'high' as const } : { quality: 'low' as const }),
    },
    warnings: [...new Set(warnings)].slice(0, 8),
  }
}

function buildMatchTitle(homeName: string | null, awayName: string | null, competition: string | null, round: number | null, fallback: string | null): string | null {
  const clubs = homeName && awayName ? `${homeName} vs ${awayName}` : null
  const suffix = [competition, round !== null ? `Round ${round}` : null].filter(Boolean).join(' · ')
  const title = clubs ? (suffix ? `${clubs} — ${suffix}` : clubs) : suffix
  // The title field is limited to 180 characters, so long names can never fail response validation.
  return (title || fallback)?.slice(0, 180) ?? null
}
