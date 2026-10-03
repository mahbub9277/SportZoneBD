import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'
import type { LeagueCode, LeagueStandingsResponse, StandingsCompetition } from './standings.types'

export const standingsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getStandingsCompetitions: builder.query<StandingsCompetition[], void>({
      query: () => 'standings/competitions',
      transformResponse: (response: ApiResponse<StandingsCompetition[]>) => unwrapApiResponse(response),
      providesTags: ['Standings'],
    }),
    getLeagueStandings: builder.query<LeagueStandingsResponse, { leagueCode: LeagueCode }>({
      query: ({ leagueCode }) => ({
        url: 'standings',
        params: { leagueCode },
      }),
      transformResponse: (response: ApiResponse<LeagueStandingsResponse>) => unwrapApiResponse(response),
      providesTags: (_result, _error, arg) => [{ type: 'Standings' as const, id: arg.leagueCode }],
    }),
  }),
  overrideExisting: false,
})

export const { useGetLeagueStandingsQuery, useGetStandingsCompetitionsQuery } = standingsApi
