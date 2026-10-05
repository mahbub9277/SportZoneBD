import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import type { Match } from '../matches/matches.types'

type GetAdminPendingMatchesParams = {
  page?: number
  limit?: number
  search?: string
}

// A pending match is a Match row that was automatically discovered by a data
// provider and is waiting for an admin to accept or reject it. Declared explicitly instead of
// deriving it from `Match`, because `Match` carries an index signature that would erase every
// named property when it is Omit-ed.
export type PendingMatch = {
  id: string
  title: string
  status: 'PENDING'
  kickoffAt: string
  sport?: string | null
  tournamentName?: string | null
  competition?: { id?: string; name?: string | null } | null
  homeTeamName?: string | null
  awayTeamName?: string | null
  homeTeamLogo?: string | null
  awayTeamLogo?: string | null
  providerFixtureKey?: string | null
  createdAt?: string
}

export type PendingMatchesPage = PaginatedResult<PendingMatch>

export const adminPendingMatchesApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getAdminPendingMatches: builder.query<PendingMatchesPage, GetAdminPendingMatchesParams>({
      query: (params) => ({
        url: 'admin/matches/pending',
        params,
      }),
      transformResponse: (response: ApiResponse<PendingMatchesPage>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'Matches' as const, id })), { type: 'Matches', id: 'LIST_PENDING' }]
          : [{ type: 'Matches', id: 'LIST_PENDING' }],
    }),
    acceptPendingMatch: builder.mutation<Match, string>({
      query: (id) => ({
        url: `admin/matches/${id}/accept`,
        method: 'PATCH',
      }),
      transformResponse: (response: ApiResponse<Match>) => unwrapApiResponse(response),
      // Accepting publishes the match, so every match list that could show it must refresh.
      invalidatesTags: (_result, _error, id) => [
        { type: 'Matches', id },
        { type: 'Matches', id: 'LIST_PENDING' },
        { type: 'Matches', id: 'LIST' },
        { type: 'Matches', id: 'LIST_UPCOMING' },
        { type: 'Matches', id: 'LIST_LIVE' },
        { type: 'Matches', id: 'LIST_FINISHED' },
        { type: 'Matches', id: 'LIST_ALL' },
        { type: 'UpcomingMatch', id: 'LIST' },
      ],
    }),
    rejectPendingMatch: builder.mutation<{ id: string }, string>({
      query: (id) => ({
        url: `admin/matches/${id}/reject`,
        method: 'PATCH',
      }),
      transformResponse: (response: ApiResponse<{ id: string }>) => unwrapApiResponse(response),
      // Rejection is permanent and there is no undo, so only the pending queue changes.
      invalidatesTags: (_result, _error, id) => [{ type: 'Matches', id }, { type: 'Matches', id: 'LIST_PENDING' }],
    }),
  }),
})

export const {
  useGetAdminPendingMatchesQuery,
  useAcceptPendingMatchMutation,
  useRejectPendingMatchMutation,
} = adminPendingMatchesApi
