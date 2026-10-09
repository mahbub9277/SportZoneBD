import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

export type AiEntityType = 'EVENT' | 'CHANNEL' | 'BANNER' | 'SUBSCRIPTION_PLAN' | 'ADVERTISEMENT' | 'CATEGORY' | 'ROLE' | 'REPORT' | 'POPUP' | 'EMAIL_NOTIFICATION' | 'PUSH_NOTIFICATION' | 'WEBSITE_SETTINGS' | 'MATCH'

export interface GenerateDescriptionRequest {
  entityType: AiEntityType
  title: string | null
  subtitle?: string
  context?: Record<string, unknown>
  language?: 'auto' | 'en' | 'bn' | 'banglish'
  tone?: 'professional' | 'concise' | 'friendly'
  /** Optional character range the generated text has to satisfy; the server enforces it. */
  length?: { min: number; max: number }
}

export interface ParseMatchRequest {
  input: string
  /** The sport already selected in the form, so the parser uses that sport's vocabulary. */
  sport?: ParsedMatchDetails['sport']
  /** The competition already typed in the form, so the parse stays consistent with it. */
  tournamentName?: string | null
}

export type AiConfidenceLevel = 'high' | 'medium' | 'low'

export interface ParsedMatchDetails {
  title: string | null
  tournamentName: string | null
  sport: 'CRICKET' | 'FOOTBALL' | 'BASKETBALL' | 'TENNIS' | 'MOTORSPORTS' | 'WWE' | null
  homeTeamName: string | null
  awayTeamName: string | null
  /** Existing `Team` id resolved by the server, never suggested by the model. */
  homeTeamId: string | null
  awayTeamId: string | null
  homeTeamLogo: string | null
  awayTeamLogo: string | null
  /** League matchday/round number, when the input stated one. */
  round: number | null
  timezone: string
  kickoffDate: string | null
  kickoffTime: string | null
  expectedDurationMinutes: number | null
  autoFinish: boolean | null
  preStartEnabled: boolean | null
  preStartWindowMinutes: number | null
  primaryStreamUrl: string | null
  quality: string | null
  confidence: Record<string, AiConfidenceLevel>
  warnings: string[]
  /**
   * One-line match summary composed by the server from the parsed values. It is always between 80 and
   * 100 characters when present, and null with a warning when no truthful sentence of that length
   * could be written.
   */
  description: string | null
}

export const aiApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    generateDescription: builder.mutation<{ description: string }, GenerateDescriptionRequest>({
      query: (body) => ({ url: '/ai/description/generate', method: 'POST', body }),
      transformResponse: (response: ApiResponse<{ description: string }>) => unwrapApiResponse(response),
    }),
    parseMatch: builder.mutation<ParsedMatchDetails, ParseMatchRequest>({
      query: (body) => ({ url: '/ai/match/parse', method: 'POST', body }),
      transformResponse: (response: ApiResponse<ParsedMatchDetails>) => unwrapApiResponse(response),
    }),
  }),
  overrideExisting: false,
})

export const { useGenerateDescriptionMutation, useParseMatchMutation } = aiApi
