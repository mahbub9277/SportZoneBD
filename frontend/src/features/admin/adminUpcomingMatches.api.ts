import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import type { Match } from '../matches/matches.types'

// Helper function to transform sort string from frontend format (e.g., 'date-asc')
// to backend format (e.g., 'kickoffAt:asc')
const transformSortParam = (sort?: string) => {
  if (!sort) return undefined;
  const [field, order] = sort.split('-');
  switch (field) {
    case 'date': return `kickoffAt:${order}`;
    case 'title': return `title:${order}`;
    default: return sort; // Return as is if no specific mapping
  }
};

export const adminUpcomingMatchesApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getAdminUpcomingMatches: builder.query<PaginatedResult<Match>, { page?: number; limit?: number; search?: string; sort?: string }>({
      query: (params) => ({
        url: 'admin/matches/upcoming',
        params: { ...params, sort: transformSortParam(params.sort) },
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<Match>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'UpcomingMatch' as const, id })), { type: 'UpcomingMatch', id: 'LIST' }]
          : [{ type: 'UpcomingMatch', id: 'LIST' }],
    }),
    createMatch: builder.mutation<Match, FormData>({
      query: (formData) => ({
        url: 'admin/matches',
        method: 'POST',
        body: formData,
      }),
      invalidatesTags: [{ type: 'UpcomingMatch', id: 'LIST' }],
    }),
  }),
})

export const {
  useGetAdminUpcomingMatchesQuery,
  useCreateMatchMutation,
} = adminUpcomingMatchesApi