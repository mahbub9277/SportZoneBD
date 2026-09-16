import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import type { Match, Highlight } from './matches.types'

interface GetMatchesParams {
  page?: number
  limit?: number
  search?: string
  status?: string
  premium?: boolean
  activeOnly?: boolean
  sort?: string
}

// Helper function to transform a frontend-friendly sort value
// (for example: 'date-asc') into a backend-friendly Prisma sort value
// (for example: 'kickoffAt:asc').
const transformSortParam = (sort?: string) => {
  if (!sort) return undefined

  const normalized = sort.trim()
  const [rawField, rawOrder] = normalized.includes(':') ? normalized.split(':') : normalized.split('-')
  const field = rawField?.trim().toLowerCase()
  const order = rawOrder?.trim().toLowerCase()

  if (!field || !order || !['asc', 'desc'].includes(order)) {
    return undefined
  }

  switch (field) {
    case 'date':
    case 'kickoffat':
      return `kickoffAt:${order}`
    case 'title':
      return `title:${order}`
    case 'createdat':
      return `createdAt:${order}`
    case 'kickoffAt':
      return `kickoffAt:${order}`
    default:
      return undefined
  }
}

export const matchesApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    /**
     * Fetches a paginated and filterable list of matches.
     */
    getMatches: builder.query<PaginatedResult<Match>, GetMatchesParams | void>({
      query: (params) => ({
        url: 'matches',
        params: {
          ...(params || {}),
          sort: transformSortParam(params?.sort),
        },
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<Match>>) =>
        unwrapApiResponse(response, {
          items: [],
          meta: {
            totalItems: 0,
            itemCount: 0,
            itemsPerPage: 10,
            totalPages: 0,
            currentPage: 1,
          },
        }),
      // Provides a generic list tag, and specific tags for each match.
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'Matches' as const, id })), { type: 'Matches', id: 'LIST' }]
          : [{ type: 'Matches', id: 'LIST' }],
    }),

    /**
     * Fetches a single match by its ID.
     */
    getMatchById: builder.query<Match, string>({
      query: (id) => `matches/${id}`,
      transformResponse: (response: ApiResponse<Match>) => unwrapApiResponse<Match>(response),
      // Provides a specific tag for this match ID.
      providesTags: (_result, _error, id) => [{ type: 'Matches', id }],
    }),

    /**
     * Fetches highlights for a specific match.
     */
    getMatchHighlights: builder.query<Highlight[], string>({
      query: (matchId) => `matches/${matchId}/highlights`,
      transformResponse: (response: ApiResponse<Highlight[]>) => unwrapApiResponse(response),
      providesTags: (_result, _error, matchId) => [{ type: 'Highlight', id: `LIST_${matchId}` }],
    }),
  }),
  overrideExisting: false,
})

export const {
  useGetMatchesQuery,
  useGetMatchByIdQuery,
  useGetMatchHighlightsQuery,
} = matchesApi