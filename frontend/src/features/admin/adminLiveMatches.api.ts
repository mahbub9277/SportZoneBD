import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse, transformSortParam } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import type { Match } from '../matches/matches.types'

type GetMatchesParams = {
  page?: number
  limit?: number
  search?: string,
  sort?: string
}

type UpdateMatchStatusPayload = {
  id: string
  status: 'UPCOMING' | 'LIVE' | 'FINISHED'
}

type ExtendMatchPayload = { id: string; minutes: number }

type UpdateMatchPayload = {
  id: string
  formData: FormData
}

/**
 * Consolidated API slice for all admin-related match operations.
 */
export const adminMatchesApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    // QUERIES
    getAdminLiveMatches: builder.query<PaginatedResult<Match>, GetMatchesParams>({
      query: (params) => ({
        url: 'admin/matches/live',
        params: { ...params, sort: transformSortParam(params.sort) },
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<Match>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'Matches' as const, id })), { type: 'Matches', id: 'LIST_LIVE' }]
          : [{ type: 'Matches', id: 'LIST_LIVE' }],
    }),
    getAdminUpcomingMatches: builder.query<PaginatedResult<Match>, GetMatchesParams>({
      query: (params) => ({
        url: 'admin/matches/upcoming',
        params: { ...params, sort: transformSortParam(params.sort) },
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<Match>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'Matches' as const, id })), { type: 'Matches', id: 'LIST_UPCOMING' }]
          : [{ type: 'Matches', id: 'LIST_UPCOMING' }],
    }),
    getAdminFinishedMatches: builder.query<PaginatedResult<Match>, GetMatchesParams>({
      query: (params) => ({
        url: 'admin/matches/finished',
        params: { ...params, sort: transformSortParam(params.sort) },
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<Match>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'Matches' as const, id })), { type: 'Matches', id: 'LIST_FINISHED' }]
          : [{ type: 'Matches', id: 'LIST_FINISHED' }],
    }),

    // MUTATIONS
    createMatch: builder.mutation<Match, FormData>({
      query: (formData) => ({
        url: 'admin/matches',
        method: 'POST',
        body: formData,
      }),
      // Invalidate all lists where the new match might appear
      invalidatesTags: [{ type: 'Matches', id: 'LIST_UPCOMING' }, { type: 'Matches', id: 'LIST_LIVE' }],
    }),
    updateMatch: builder.mutation<Match, UpdateMatchPayload>({
      query: ({ id, formData }) => ({
        url: `admin/matches/${id}`,
        method: 'PATCH',
        body: formData,
      }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Matches', id }, { type: 'Matches', id: 'LIST_UPCOMING' }, { type: 'Matches', id: 'LIST_LIVE' }, { type: 'Matches', id: 'LIST_FINISHED' }],
    }),
    updateMatchStatus: builder.mutation<Match, UpdateMatchStatusPayload>({
      query: ({ id, status }) => ({
        url: `admin/matches/${id}/status`,
        method: 'PATCH',
        body: { status },
      }),
      // Invalidate all status-based lists as the match will move from one to another
      invalidatesTags: [{ type: 'Matches', id: 'LIST_UPCOMING' }, { type: 'Matches', id: 'LIST_LIVE' }, { type: 'Matches', id: 'LIST_FINISHED' }],
    }),
    extendMatch: builder.mutation<Match, ExtendMatchPayload>({
      query: ({ id, minutes }) => ({ url: `admin/matches/${id}/extend`, method: 'PATCH', body: { minutes } }),
      transformResponse: (response: ApiResponse<Match>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Matches', id: 'LIST_LIVE' }, { type: 'Matches', id: 'LIST_UPCOMING' }],
    }),
  }),
})

export const {
  useGetAdminLiveMatchesQuery,
  useGetAdminUpcomingMatchesQuery,
  useGetAdminFinishedMatchesQuery,
  useCreateMatchMutation,
  useUpdateMatchMutation,
  useUpdateMatchStatusMutation,
  useExtendMatchMutation,
} = adminMatchesApi