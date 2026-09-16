import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse, transformSortParam } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import type { Match } from '../matches/matches.types'

type GetAdminFinishedMatchesParams = {
  page?: number
  limit?: number
  sort?: string // Renamed from sortBy for consistency
  search?: string
}

export const adminFinishedMatchesApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getAdminFinishedMatches: builder.query<PaginatedResult<Match>, GetAdminFinishedMatchesParams>({
      query: (params) => ({ url: 'admin/matches/finished', params: { ...params, sort: transformSortParam(params.sort) } }),
      transformResponse: (response: ApiResponse<PaginatedResult<Match>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'FinishedMatch' as const, id })), { type: 'FinishedMatch', id: 'LIST' }]
          : [{ type: 'FinishedMatch', id: 'LIST' }],
    }),
  }),
})

export const {
  useGetAdminFinishedMatchesQuery,
} = adminFinishedMatchesApi