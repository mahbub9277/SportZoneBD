import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

export type AiEntityType = 'EVENT' | 'CHANNEL' | 'BANNER' | 'SUBSCRIPTION_PLAN' | 'ADVERTISEMENT' | 'CATEGORY' | 'ROLE' | 'REPORT' | 'POPUP' | 'EMAIL_NOTIFICATION' | 'PUSH_NOTIFICATION' | 'WEBSITE_SETTINGS'

export interface GenerateDescriptionRequest {
  entityType: AiEntityType
  title: string | null
  subtitle?: string
  context?: Record<string, unknown>
  language?: 'auto' | 'en' | 'bn' | 'banglish'
  tone?: 'professional' | 'concise' | 'friendly'
}

export interface ParseMatchRequest {
  input: string
}

export type AiConfidenceLevel = 'high' | 'medium' | 'low'

export interface ParsedMatchDetails {
  title: string | null
  tournamentName: string | null
  sport: 'CRICKET' | 'FOOTBALL' | 'BASKETBALL' | 'TENNIS' | 'MOTORSPORTS' | 'WWE' | null
  homeTeamName: string | null
  awayTeamName: string | null
  homeTeamLogo: string | null
  awayTeamLogo: string | null
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
