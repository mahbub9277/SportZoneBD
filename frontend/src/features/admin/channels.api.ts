import { emptyApi } from '../../app/api/emptyApi'
import type { Channel, ChannelCategory } from '../../shared/types'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

export const channelsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getChannelReactions: builder.query<{ likeCount: number; dislikeCount: number; userReaction: 'LIKE' | 'DISLIKE' | null }, string>({
      query: (id) => `/channels/${id}/reactions`,
      transformResponse: (response: ApiResponse<{ likeCount: number; dislikeCount: number; userReaction: 'LIKE' | 'DISLIKE' | null }>) => unwrapApiResponse(response),
      providesTags: (_result, _error, id) => [{ type: 'Channels' as const, id: `REACTIONS_${id}` }],
    }),
    toggleChannelReaction: builder.mutation<{ likeCount: number; dislikeCount: number; userReaction: 'LIKE' | 'DISLIKE' | null }, { id: string; type: 'LIKE' | 'DISLIKE' }>({
      query: ({ id, type }) => ({ url: `/channels/${id}/reactions`, method: 'POST', body: { type } }),
      transformResponse: (response: ApiResponse<{ likeCount: number; dislikeCount: number; userReaction: 'LIKE' | 'DISLIKE' | null }>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Channels', id: `REACTIONS_${id}` }, { type: 'Channels', id: 'LIST' }],
    }),
    // --- PUBLIC QUERIES (SHOULD BE MOVED TO A PUBLIC API SLICE) ---
    getPublicChannels: builder.query<ChannelCategory[], void>({
      query: () => 'channels',
      transformResponse: (response: ApiResponse<ChannelCategory[]>) => unwrapApiResponse(response),
      providesTags: (result) => result ? [{ type: 'Channels', id: 'LIST' }, { type: 'ChannelCategories', id: 'LIST' }] : [],
    }),
    getPublicChannelsByIds: builder.query<Channel[], string[]>({
      query: (ids) => ({
        url: `/channels/by-ids`,
        params: { ids: ids.join(',') },
      }),
      transformResponse: (response: ApiResponse<Channel[]>) => unwrapApiResponse(response),
      providesTags: (result) => result ? result.map(({ id }) => ({ type: 'Channels' as const, id })) : [],
    }),
    getWatchChannelData: builder.query<{ channel: Channel; relatedChannels: Channel[]; liveViewers: number }, string>({
      query: (id) => `/channels/watch/${id}`,
      transformResponse: (response: ApiResponse<{ channel: Channel; relatedChannels: Channel[]; liveViewers: number }>) => unwrapApiResponse(response), 
      providesTags: (_result, _error, id) => [{ type: 'Channels' as const, id }],
    }),
    enterChannelViewer: builder.mutation<{ liveViewers: number }, { id: string; viewerId: string }>({
      query: ({ id, viewerId }) => ({
        url: `/channels/${id}/viewers/enter`,
        method: 'POST',
        body: { viewerId },
      }),
      transformResponse: (response: ApiResponse<{ liveViewers: number }>) => unwrapApiResponse(response),
    }),
    leaveChannelViewer: builder.mutation<{ liveViewers: number }, { id: string; viewerId: string }>({
      query: ({ id, viewerId }) => ({
        url: `/channels/${id}/viewers/leave`,
        method: 'POST',
        body: { viewerId },
      }),
      transformResponse: (response: ApiResponse<{ liveViewers: number }>) => unwrapApiResponse(response),
    }),
    getRelatedChannels: builder.query<Channel[], { id: string; excludeIds?: string[] }>({
      query: ({ id, excludeIds = [] }) => ({
        url: `/channels/${id}/related`,
        params: excludeIds.length > 0 ? { excludeIds: excludeIds.join(',') } : undefined,
      }),
      transformResponse: (response: ApiResponse<Channel[]>) => unwrapApiResponse(response),
      providesTags: (result) => result ? result.map(({ id }) => ({ type: 'Channels' as const, id })) : [],
    }),

    /**
     * =================================================================================
     * ADMIN ENDPOINTS - These should be moved to a dedicated `adminApi.ts` file.
     * All URLs are corrected to use the `/admin` prefix.
     * =================================================================================
     */
    getAdminChannels: builder.query<Channel[], void>({
      query: () => '/channels/all',
      transformResponse: (response: ApiResponse<Channel[]>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result
          ? [...result.map(({ id }) => ({ type: 'Channels' as const, id })), { type: 'Channels' as const, id: 'LIST' }]
          : [{ type: 'Channels', id: 'LIST' }],
    }),
    getAdminCategories: builder.query<ChannelCategory[], void>({
      query: () => '/channels/categories/all',
      transformResponse: (response: ApiResponse<ChannelCategory[]>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result
          ? [...result.map(({ id }) => ({ type: 'ChannelCategories' as const, id })), { type: 'ChannelCategories' as const, id: 'LIST' }]
          : [{ type: 'ChannelCategories', id: 'LIST' }],
    }),
    getChannelById: builder.query<Channel, string>({
      query: (id) => `/channels/admin/${id}`,
      transformResponse: (response: ApiResponse<Channel>) => unwrapApiResponse(response),
      providesTags: (_result, _error, id) => [{ type: 'Channels' as const, id }],
    }),

    // --- Admin Mutations (Category) ---
    createCategory: builder.mutation<ChannelCategory, Partial<ChannelCategory> | FormData>({
      query: (body) => ({
        url: '/channels/categories',
        method: 'POST',
        body,
      }),
      transformResponse: (response: ApiResponse<ChannelCategory>) => unwrapApiResponse(response),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          const { data: createdCategory } = await queryFulfilled
          dispatch(
            channelsApi.util.updateQueryData('getAdminCategories', undefined, (draft) => {
              if (draft.some((category) => category.id === createdCategory.id)) return
              draft.push({ ...createdCategory, channels: createdCategory.channels ?? [] })
              draft.sort((first, second) => first.name.localeCompare(second.name))
            }),
          )
        } catch {
          // The mutation error is handled by the form; leave the cached list unchanged.
        }
      },
      invalidatesTags: [{ type: 'ChannelCategories', id: 'LIST' }],
    }),
    updateCategory: builder.mutation<ChannelCategory, { id: string; data?: Partial<ChannelCategory>; formData?: FormData }>({
      query: ({ id, data, formData }) => ({
        url: `/channels/categories/${id}`,
        method: 'PUT',
        body: formData ?? data ?? {},
      }),
      transformResponse: (response: ApiResponse<ChannelCategory>) => unwrapApiResponse(response),
      invalidatesTags: (result, error, { id }) => [
        { type: 'ChannelCategories', id: 'LIST' },
        { type: 'ChannelCategories', id },
      ] as const,
    }),
    deleteCategory: builder.mutation<void, string>({
      query: (id) => ({
        url: `/channels/categories/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'ChannelCategories', id: 'LIST' }, { type: 'Channels', id: 'LIST' }], // Also invalidate channels
    }),

    // --- Admin Mutations (Channel) ---
    createChannel: builder.mutation<Channel, FormData>({
      // The body is now FormData, RTK Query handles the content-type.
      query: (formData) => ({ url: '/channels', method: 'POST', body: formData }),
      transformResponse: (response: ApiResponse<Channel>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Channels', id: 'LIST' }],
    }),
    updateChannel: builder.mutation<Channel, { id: string; formData: FormData }>({
      // The body is now FormData, RTK Query handles the content-type.
      query: ({ id, formData }) => ({ url: `/channels/${id}`, method: 'PUT', body: formData }),
      transformResponse: (response: ApiResponse<Channel>) => unwrapApiResponse(response),
      // We still invalidate tags on success to ensure the cache is perfectly in sync with the server.
      invalidatesTags: (result, error, { id }) => [
        { type: 'Channels', id: 'LIST' }, { type: 'Channels', id },
      ] as const,
    }),
    deleteChannel: builder.mutation<void, string>({
      query: (id) => ({ url: `/channels/${id}`, method: 'DELETE' }),
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        const patchResult = dispatch(
          channelsApi.util.updateQueryData('getAdminChannels', undefined, (draft) => {
            // The draft is the entire response object, which is { data: Channel[] }
            // Find the index of the channel to remove
            const index = draft.findIndex((channel) => channel.id === id)
            if (index !== -1) {
              draft.splice(index, 1)
            }
          }),
        )
        try {
          await queryFulfilled
        } catch {
          patchResult.undo()
        }
      },
    }),
  }),
  overrideExisting: false,
})

export const {
  useGetPublicChannelsQuery,
  useGetPublicChannelsByIdsQuery,
  useGetWatchChannelDataQuery,
  useGetChannelReactionsQuery,
  useToggleChannelReactionMutation,
  useEnterChannelViewerMutation,
  useLeaveChannelViewerMutation,
  useGetRelatedChannelsQuery,
  useLazyGetRelatedChannelsQuery,
  useGetAdminChannelsQuery,
  useGetAdminCategoriesQuery,
  useGetChannelByIdQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
  useCreateChannelMutation,
  useUpdateChannelMutation,
  useDeleteChannelMutation,
} = channelsApi