import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'

export interface Highlight {
  id: string
  matchId?: string | null
  title: string
  thumbnail: string | null
  thumbnailUrl?: string | null
  duration: string | null
  category: string | null
  url: string
  createdAt: string
  updatedAt: string
}
// Allow tempId for optimistic updates
export type CreateHighlightPayload = Omit<Highlight, 'id' | 'createdAt' | 'updatedAt'> & { tempId?: string; duration?: string | null; category?: string | null; };
export type UpdateHighlightPayload = { id: string } & Partial<CreateHighlightPayload>

export const adminHighlightsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getAdminHighlights: builder.query<PaginatedResult<Highlight>, { page?: number; limit?: number }>({
      query: (params) => ({
        url: 'highlights',
        params,
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<Highlight>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'Highlight' as const, id })), { type: 'Highlight', id: 'LIST' }]
          : [{ type: 'Highlight', id: 'LIST' }],
    }),

    createHighlight: builder.mutation<Highlight, CreateHighlightPayload>({
      query: (body) => {
        // Remove tempId before sending to the backend
        const rest = { ...body };
        delete (rest as { tempId?: string }).tempId;
        return {
          url: 'highlights',
          method: 'POST',
          body: rest,
        };
      },
      transformResponse: (response: ApiResponse<Highlight>) => unwrapApiResponse(response),
      async onQueryStarted(newHighlight, { dispatch, queryFulfilled }) {
        // Optimistically add the new highlight to the list
        const patchResult = dispatch(
          adminHighlightsApi.util.updateQueryData('getAdminHighlights', {}, (draft) => {
            // Use the tempId for the optimistic entry, or a placeholder if not available
            const optimisticId = newHighlight.tempId || `optimistic-${Math.random().toString(36).substring(2, 9)}`;
            // Create a mock Highlight object for the optimistic update
            draft.items.unshift({ 
              ...newHighlight, 
              id: optimisticId, 
              createdAt: new Date().toISOString(), 
              updatedAt: new Date().toISOString() 
            } as Highlight);
          })
        );
        try {
          await queryFulfilled;
          // The actual highlight from the server will replace the optimistic one due to invalidation
          // No explicit invalidation needed here if the backend returns the new item and providesTags is set correctly
          // However, invalidating the list ensures consistency, especially if filters/sorting are involved.
          dispatch(adminHighlightsApi.util.invalidateTags([{ type: 'Highlight', id: 'LIST' }]));
        } catch {
          patchResult.undo(); // Revert optimistic update on error
        }
      },
      invalidatesTags: [{ type: 'Highlight', id: 'LIST' }],
    }),

    updateHighlight: builder.mutation<Highlight, UpdateHighlightPayload>({
      query: ({ id, ...body }) => ({
        url: `highlights/${id}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: ApiResponse<Highlight>) => unwrapApiResponse(response),
      async onQueryStarted({ id, ...patch }, { dispatch, queryFulfilled }) {
        // Optimistically update the highlight in the list
        const patchResult = dispatch(
          adminHighlightsApi.util.updateQueryData('getAdminHighlights', {}, (draft) => {
            const highlightToUpdate = draft.items.find((highlight) => highlight.id === id);
            if (highlightToUpdate) {
              Object.assign(highlightToUpdate, patch);
            }
          })
        );
        try {
          await queryFulfilled;
          // Invalidate specific item and list to ensure consistency
          dispatch(adminHighlightsApi.util.invalidateTags([{ type: 'Highlight', id }, { type: 'Highlight', id: 'LIST' }]));
        } catch {
          patchResult.undo(); // Revert optimistic update on error
        }
      },
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Highlight', id },
        { type: 'Highlight', id: 'LIST' },
      ],
    }),

    deleteHighlight: builder.mutation<{ success: boolean; id: string }, string>({
      query: (id) => ({
        url: `highlights/${id}`,
        method: 'DELETE',
      }),
      transformResponse: (response: ApiResponse<{ success: boolean; id: string }>) => unwrapApiResponse(response),
      async onQueryStarted(id, { dispatch, queryFulfilled }) {
        // Optimistically remove the highlight from the list
        const patchResult = dispatch(
          adminHighlightsApi.util.updateQueryData('getAdminHighlights', {}, (draft) => {
            draft.items = draft.items.filter((highlight) => highlight.id !== id);
          })
        );
        try {
          await queryFulfilled;
          // Invalidate specific item and list to ensure consistency
          dispatch(adminHighlightsApi.util.invalidateTags([{ type: 'Highlight', id }, { type: 'Highlight', id: 'LIST' }]));
        } catch {
          patchResult.undo(); // Revert optimistic update on error
        }
      },
      invalidatesTags: (_result, _error, id) => [{ type: 'Highlight', id }, { type: 'Highlight', id: 'LIST' }],
    }),
  }),
})

export const { useGetAdminHighlightsQuery, useCreateHighlightMutation, useUpdateHighlightMutation, useDeleteHighlightMutation } = adminHighlightsApi