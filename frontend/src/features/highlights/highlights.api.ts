import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import type { Highlight } from '../highlights/highlights.types'

type GetHighlightsParams = {
  page?: number
  limit?: number
  matchId?: string // To fetch highlights for a specific match
}

/**
 * User-facing API slice for fetching highlight data.
 */
export const highlightsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    /**
     * Fetches a paginated list of highlights. Can be filtered by matchId.
     */
    getHighlights: builder.query<PaginatedResult<Highlight>, GetHighlightsParams | void>({
      query: (params) => ({ url: 'highlights', params: params || {} }),
      transformResponse: (response: ApiResponse<PaginatedResult<Highlight>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'Highlight' as const, id })), { type: 'Highlight', id: 'LIST' }]
          : [{ type: 'Highlight', id: 'LIST' }],
    }),

    /**
     * Fetches a single highlight by its ID.
     */
    getHighlightById: builder.query<Highlight, string>({
      query: (id) => `highlights/${id}`,
      transformResponse: (response: ApiResponse<Highlight>) => unwrapApiResponse(response),
      providesTags: (_result, _error, id) => [{ type: 'Highlight', id }],
    }),

    /**
     * Records one intentional highlight view and returns the authoritative count.
     * Deliberately does not invalidate tags so opening a highlight never refetches the list.
     */
    incrementHighlightView: builder.mutation<{ id: string; viewCount: number }, string>({
      query: (id) => ({ url: `highlights/${id}/view`, method: 'POST' }),
      transformResponse: (response: ApiResponse<{ id: string; viewCount: number }>) => unwrapApiResponse(response),
    }),
  }),
})

export const { useGetHighlightsQuery, useGetHighlightByIdQuery, useIncrementHighlightViewMutation } = highlightsApi