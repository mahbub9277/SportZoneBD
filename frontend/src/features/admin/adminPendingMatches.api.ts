import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import type { Match } from '../matches/matches.types'

type GetAdminPendingMatchesParams = {
  page?: number
  limit?: number
  search?: string
  /** Inclusive kickoff range, as ISO instants resolved from the Bangladesh days the admin filtered on. */
  kickoffFrom?: string
  kickoffTo?: string
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
  /** League round or matchday as discovered from the provider; null when it stated none. */
  round?: number | null
  season?: string | null
  competition?: { id?: string; name?: string | null } | null
  homeTeamName?: string | null
  awayTeamName?: string | null
  homeTeamLogo?: string | null
  awayTeamLogo?: string | null
  providerFixtureKey?: string | null
  createdAt?: string
}

export type PendingMatchesPage = PaginatedResult<PendingMatch>

/** What the server says happened to one requested fixture in a bulk review. */
export type PendingReviewOutcome = 'accepted' | 'rejected' | 'already_processed' | 'ineligible' | 'missing' | 'failed'

export interface PendingBulkReviewResult {
  requested: number
  accepted: number
  rejected: number
  alreadyProcessed: number
  ineligible: number
  missing: number
  failed: number
  /** Rows the database actually changed, which differs from `accepted` when a request is repeated. */
  databaseChanges: number
  results: Array<{ id: string; providerFixtureKey: string | null; outcome: PendingReviewOutcome }>
}

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
    // One request for a bounded batch of ids: the server applies the same conditional updates the single
    // row actions use and answers with a per-item outcome, so partial failures stay visible.
    bulkAcceptPendingMatches: builder.mutation<PendingBulkReviewResult, string[]>({
      query: (ids) => ({
        url: 'admin/matches/pending/bulk-accept',
        method: 'POST',
        body: { ids },
      }),
      transformResponse: (response: ApiResponse<PendingBulkReviewResult>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, ids) => [
        ...ids.map((id) => ({ type: 'Matches' as const, id })),
        { type: 'Matches', id: 'LIST_PENDING' },
        { type: 'Matches', id: 'LIST' },
        { type: 'Matches', id: 'LIST_UPCOMING' },
        { type: 'Matches', id: 'LIST_LIVE' },
        { type: 'Matches', id: 'LIST_FINISHED' },
        { type: 'Matches', id: 'LIST_ALL' },
        { type: 'UpcomingMatch', id: 'LIST' },
      ],
    }),
    bulkRejectPendingMatches: builder.mutation<PendingBulkReviewResult, string[]>({
      query: (ids) => ({
        url: 'admin/matches/pending/bulk-reject',
        method: 'POST',
        body: { ids },
      }),
      transformResponse: (response: ApiResponse<PendingBulkReviewResult>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, ids) => [
        ...ids.map((id) => ({ type: 'Matches' as const, id })),
        { type: 'Matches', id: 'LIST_PENDING' },
      ],
    }),
  }),
})

export const {
  useGetAdminPendingMatchesQuery,
  useAcceptPendingMatchMutation,
  useRejectPendingMatchMutation,
  useBulkAcceptPendingMatchesMutation,
  useBulkRejectPendingMatchesMutation,
} = adminPendingMatchesApi
