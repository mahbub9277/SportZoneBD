import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'
import type { StandingsTable } from './standings.types'

export const standingsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getStandings: builder.query<StandingsTable, { leagueId?: string; season?: number } | void>({
      query: (params) => ({
        url: 'standings',
        params: params ?? undefined,
      }),
      transformResponse: (response: ApiResponse<StandingsTable>) => unwrapApiResponse(response),
      providesTags: (_result, _error, arg) => [{ type: 'Standings' as const, id: arg?.leagueId ?? 'DEFAULT' }],
    }),
  }),
  overrideExisting: false,
})

export const { useGetStandingsQuery } = standingsApi
