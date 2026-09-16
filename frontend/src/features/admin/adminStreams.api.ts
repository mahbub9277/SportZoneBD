import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'

export interface Stream {
  id: string
  matchId: string
  sourceType?: 'DIRECT_URL' | 'CHANNEL'
  channelId?: string | null
  name: string
  logo?: string | null
  primaryUrl: string
  backupUrl?: string
  enabled: boolean
  status: string
  quality: string
  createdAt: string
}

export const adminStreamsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getAdminStreams: builder.query<PaginatedResult<Stream>, { page?: number; limit?: number }>({
      query: (params) => ({ url: 'streams', params }),
      transformResponse: (response: ApiResponse<PaginatedResult<Stream>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'Stream' as const, id })), { type: 'Stream', id: 'LIST' }]
          : [{ type: 'Stream', id: 'LIST' }],
    }),
    createStream: builder.mutation<Stream, Partial<Stream>>({
      query: (body) => ({ url: 'streams', method: 'POST', body }),
      invalidatesTags: (_result, _error, stream) => [
        { type: 'Stream', id: 'LIST' },
        { type: 'Matches', id: 'LIST' },
        { type: 'Channels', id: 'LIST' },
        ...(stream.matchId ? [{ type: 'Matches' as const, id: stream.matchId }] : []),
      ],
    }),
    updateStream: builder.mutation<Stream, Partial<Stream> & { id: string }>({
      query: ({ id, ...body }) => ({ url: `streams/${id}`, method: 'PATCH', body }),
      invalidatesTags: (result, _error, { id }) => [
        { type: 'Stream', id },
        { type: 'Stream', id: 'LIST' },
        { type: 'Matches', id: 'LIST' },
        { type: 'Channels', id: 'LIST' },
        ...(result?.matchId ? [{ type: 'Matches' as const, id: result.matchId }] : []),
      ],
    }),
    deleteStream: builder.mutation<{ success: boolean; id: string }, string>({
      query: (id) => ({ url: `streams/${id}`, method: 'DELETE' }),
      transformResponse: (response: ApiResponse<{ id: string }>) => ({ success: true, id: unwrapApiResponse(response).id }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Stream', id },
        { type: 'Stream', id: 'LIST' },
        { type: 'Matches', id: 'LIST_UPCOMING' },
        { type: 'Matches', id: 'LIST_LIVE' },
        { type: 'Matches', id: 'LIST_FINISHED' },
        { type: 'Matches', id: 'LIST_ALL' },
      ],
    }),
  }),
})

export const { useGetAdminStreamsQuery, useCreateStreamMutation, useUpdateStreamMutation, useDeleteStreamMutation } = adminStreamsApi