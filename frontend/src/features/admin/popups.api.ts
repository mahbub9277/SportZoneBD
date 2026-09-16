import { emptyApi } from '../../app/api/emptyApi';
import { unwrapApiResponse } from '../../app/api/api.utils';
import type { ApiResponse } from '../../app/api/types';

export interface Popup {
  id: string;
  title: string;
  message: string;
  isActive: boolean;
  imageUrl?: string | null;
  link?: string | null;
  createdAt: string;
}

export const popupsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getPopups: builder.query<Popup[], void>({
      query: () => '/admin/popups', // Correct via adminRouter consolidation
      transformResponse: (response: ApiResponse<Popup[]>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result
          ? [...result.map(({ id }) => ({ type: 'Popup' as const, id })), { type: 'Popup', id: 'LIST' }]
          : [{ type: 'Popup', id: 'LIST' }],
    }),
    createPopup: builder.mutation<Popup, Partial<Popup>>({
      query: (body) => ({ url: '/admin/popups', method: 'POST', body }), // Correct
      transformResponse: (response: ApiResponse<Popup>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Popup', id: 'LIST' }],
    }),
    updatePopup: builder.mutation<Popup, Partial<Popup> & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/admin/popups/${id}`, method: 'PATCH', body }), // Correct
      transformResponse: (response: ApiResponse<Popup>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Popup', id }],
    }),
    deletePopup: builder.mutation<void, string>({
      query: (id) => ({ url: `/admin/popups/${id}`, method: 'DELETE' }), // Correct
      invalidatesTags: [{ type: 'Popup', id: 'LIST' }],
    }),
  }),
});

export const {
  useGetPopupsQuery,
  useCreatePopupMutation,
  useUpdatePopupMutation,
  useDeletePopupMutation,
} = popupsApi;