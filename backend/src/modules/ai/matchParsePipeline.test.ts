import test from 'node:test'
import assert from 'node:assert/strict'
import { createGeminiClient, type GeminiAttempt } from './gemini.client.js'
import { extractMatchContext, mergeMatchExtraction } from './matchParser.js'
import { pickReconciledTeam, type TeamRecord } from './teamReconciliation.js'
import { matchParseResultSchema } from './description.validator.js'

/**
 * Integration cover for the hybrid flow used by `parseMatchDetails`, with the provider faked:
 * deterministic extraction → Gemini JSON → schema validation → team reconciliation → merge.
 * (The Prisma queries that feed `pickReconciledTeam` are covered by `teamReconciliation.test.ts`.)
 */

const TODAY = '2025-03-14'
const timezone = 'Asia/Dhaka'

const teamRecord = (id: string, name: string, logoUrl: string | null): TeamRecord => ({
  id,
  name,
  normalizedName: name.trim().replace(/\s+/g, ' ').toLowerCase(),
  logoUrl,
})

const modelJson = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  title: null,
  tournamentName: null,
  sport: null,
  homeTeamName: null,
  awayTeamName: null,
  round: null,
  timezone,
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

const runPipeline = async (input: string, modelResponse: string, records: TeamRecord[] = []) => {
  const client = createGeminiClient({
    apiKey: 'test-key',
    modelChain: ['gemini-3.8-flash'],
    log: () => {},
    transport: async (_attempt: GeminiAttempt) => modelResponse,
  })

  const suggestion = await client.generate({
    contents: input,
    systemInstruction: 'test',
    temperature: 0.1,
    maxOutputTokens: 100,
  })

  const aiResult = matchParseResultSchema.parse(JSON.parse(suggestion.text))
  const context = extractMatchContext(input, TODAY)
  const merged = mergeMatchExtraction({
    aiResult,
    context,
    homeTeam: pickReconciledTeam(records, aiResult.homeTeamName) ?? pickReconciledTeam(records, context.teams.homeTeamName),
    awayTeam: pickReconciledTeam(records, aiResult.awayTeamName) ?? pickReconciledTeam(records, context.teams.awayTeamName),
    timezone,
  })

  return matchParseResultSchema.parse(merged)
}

test('the same fixture is understood in English, Banglish and Bangla', async () => {
  const inputs = [
    'Real Madrid vs Barcelona, La Liga round 5, today at 10:30 PM',
    'ajke rat 10:30 e real Madrid vs Barcelonar la ligar round 5 er match',
    'আজ রাত সাড়ে দশটায় রিয়াল মাদ্রিদ বনাম বার্সেলোনার লা লিগার ৫ম রাউন্ড',
  ]

  for (const input of inputs) {
    const result = await runPipeline(input, modelJson())
    assert.equal(result.tournamentName, 'La Liga', `competition for: ${input}`)
    assert.equal(result.round, 5, `round for: ${input}`)
    assert.equal(result.kickoffDate, TODAY, `date for: ${input}`)
    assert.equal(result.kickoffTime, '22:30', `time for: ${input}`)
    assert.equal(result.sport, null, `sport for: ${input}`)
  }
})

test('a model suggestion fills what the deterministic layer cannot read', async () => {
  const result = await runPipeline(
    'Real Madrid vs Barcelona',
    modelJson({ tournamentName: 'La Liga', sport: 'FOOTBALL', kickoffTime: '20:00', confidence: { sport: 'medium' } }),
  )

  assert.equal(result.tournamentName, 'La Liga')
  assert.equal(result.sport, 'FOOTBALL')
  assert.equal(result.kickoffTime, '20:00')
  assert.equal(result.expectedDurationMinutes, 120)
})

test('deterministic values beat a conflicting model suggestion', async () => {
  const result = await runPipeline(
    'Real Madrid vs Barcelona, today at 10:30 PM',
    modelJson({ kickoffDate: '2025-03-15', kickoffTime: '22:00' }),
  )

  assert.equal(result.kickoffDate, TODAY)
  assert.equal(result.kickoffTime, '22:30')
})

test('an existing team supplies the canonical name, logo and id', async () => {
  const records = [teamRecord('team-1', 'Real Madrid', 'sportzone/teams/real-madrid')]
  const result = await runPipeline('real madrid vs Barcelona today at 10:30 PM', modelJson(), records)

  assert.equal(result.homeTeamName, 'Real Madrid')
  assert.equal(result.homeTeamId, 'team-1')
  assert.equal(result.homeTeamLogo, 'sportzone/teams/real-madrid')
  assert.equal(result.awayTeamId, null)
  assert.equal(result.awayTeamLogo, null)
})

test('a stream URL and quality are taken from the input, never from the model', async () => {
  const result = await runPipeline(
    'Real Madrid vs Barcelona 1080p https://cdn.example.com/live/index.m3u8',
    modelJson({ primaryStreamUrl: 'https://evil.example.com/other.m3u8', quality: '4k' }),
  )

  assert.equal(result.primaryStreamUrl, 'https://cdn.example.com/live/index.m3u8')
  assert.equal(result.quality, '1080p')
})

test('a sport the match table cannot store never reaches the form as a sport', async () => {
  const result = await runPipeline('Lakers vs Celtics basketball', modelJson({ sport: 'BASKETBALL' }))
  assert.equal(result.sport, null)
  assert.ok(result.warnings.some((warning) => warning.includes('Basketball')))
})

test('filler-only input yields no invented fields', async () => {
  const result = await runPipeline('ভাই দাঁড়া শোন actually okay hobe', modelJson())
  assert.equal(result.homeTeamName, null)
  assert.equal(result.awayTeamName, null)
  assert.equal(result.tournamentName, null)
  assert.equal(result.round, null)
  assert.equal(result.kickoffTime, null)
  assert.equal(result.kickoffDate, null)
})
