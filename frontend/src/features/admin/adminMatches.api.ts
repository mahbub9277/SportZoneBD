import type { Match } from '../matches/matches.types'
import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse, transformSortParam } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'

type GetMatchesParams = {
  page?: number
  limit?: number
  search?: string
  sort?: string // Renamed from sortBy for consistency
  status?: 'LIVE' | 'UPCOMING' | 'FINISHED'
}

type UpdateMatchStatusPayload = {
  id: string
  status: 'UPCOMING' | 'LIVE' | 'FINISHED'
}

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
    getAdminMatches: builder.query<PaginatedResult<Match>, GetMatchesParams>({
      query: (params) => ({
        url: 'admin/matches',
        params: { ...params, sort: transformSortParam(params.sort) },
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<Match>>) => unwrapApiResponse(response),
      providesTags: (result, _error, { status = 'ALL' }) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'Matches' as const, id })), { type: 'Matches', id: `LIST_${status}` }]
          : [{ type: 'Matches', id: `LIST_${status}` }],
    }),

    // MUTATIONS
    createMatch: builder.mutation<Match, FormData>({
      query: (formData) => ({
        url: 'admin/matches',
        method: 'POST',
        body: formData,
      }),
      transformResponse: (response: ApiResponse<Match>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Matches', id: 'LIST_UPCOMING' }, { type: 'Matches', id: 'LIST_LIVE' }, { type: 'Matches', id: 'LIST_FINISHED' }, { type: 'Matches', id: 'LIST_ALL' }],
    }),
    updateMatch: builder.mutation<Match, UpdateMatchPayload>({
      query: ({ id, formData }) => ({
        url: `admin/matches/${id}`,
        method: 'PATCH',
        body: formData,
      }),
      transformResponse: (response: ApiResponse<Match>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Matches', id },
        { type: 'Matches', id: 'LIST_UPCOMING' },
        { type: 'Matches', id: 'LIST_LIVE' },
        { type: 'Matches', id: 'LIST_FINISHED' },
        { type: 'Matches', id: 'LIST_ALL' },
      ],
    }),
    updateMatchStatus: builder.mutation<Match, UpdateMatchStatusPayload>({
      query: ({ id, status }) => ({
        url: `admin/matches/${id}/status`,
        method: 'PATCH',
        body: { status },
      }),
      transformResponse: (response: ApiResponse<Match>) => unwrapApiResponse(response),
      // Invalidate all status-based lists as the match will move from one to another
      invalidatesTags: [
        { type: 'Matches', id: 'LIST_UPCOMING' },
        { type: 'Matches', id: 'LIST_LIVE' },
        { type: 'Matches', id: 'LIST_FINISHED' },
        { type: 'Matches', id: 'LIST_ALL' },
      ],
    }),
    deleteMatch: builder.mutation<{ success: boolean; id: string }, string>({
      query: (id) => ({
        url: `admin/matches/${id}`,
        method: 'DELETE',
      }),
      transformResponse: (response: ApiResponse<{ success: boolean; id: string }>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Matches', id },
        { type: 'Matches', id: 'LIST_UPCOMING' },
        { type: 'Matches', id: 'LIST_LIVE' },
        { type: 'Matches', id: 'LIST_FINISHED' },
        { type: 'Matches', id: 'LIST_ALL' },
        { type: 'Stream', id: 'LIST' },
      ],
    }),
  }),
})

export const {
  useGetAdminMatchesQuery,
  useCreateMatchMutation,
  useUpdateMatchMutation,
  useUpdateMatchStatusMutation,
  useDeleteMatchMutation,
} = adminMatchesApi