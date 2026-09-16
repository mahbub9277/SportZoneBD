import { emptyApi } from '../../app/api/emptyApi';
import { unwrapApiResponse } from '../../app/api/api.utils';
import type { ApiResponse } from '../../app/api/types';

export interface Advertisement {
  id: string;
  title: string;
  description?: string | null;
  link: string;
  imageUrl?: string | null;
  facebookUrl?: string | null;
  youtubeUrl?: string | null;
  telegramUrl?: string | null;
  instagramUrl?: string | null;
  websiteUrl?: string | null;
  isActive: boolean;
  placement: 'MATCH' | 'CHANNEL' | 'BOTH' | 'FULL_PAGE';
  interstitialEnabled: boolean;
  durationSeconds: number;
  unlockHours: 12 | 24;
  priority: number;
}

export interface AdUnlock { expiresAt: string }
export interface AdViewSession { sessionId: string; startedAt: string; durationSeconds: number }

export const advertisementsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getAdvertisements: builder.query<Advertisement[], void>({
      query: () => '/admin/advertisements', // Correct via adminRouter consolidation
      transformResponse: (response: ApiResponse<Advertisement[]>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result
          ? [...result.map(({ id }) => ({ type: 'Advertisement' as const, id })), { type: 'Advertisement', id: 'LIST' }]
          : [{ type: 'Advertisement', id: 'LIST' }],
    }),
    getActiveAdvertisements: builder.query<Advertisement[], void>({
      query: () => '/advertisements/active', // This needs a public route setup
      transformResponse: (response: ApiResponse<Advertisement[]>) => unwrapApiResponse(response),
      providesTags: [{ type: 'Advertisement', id: 'ACTIVE_LIST' }],
    }),
    getInterstitialAdvertisement: builder.query<Advertisement | null, 'MATCH' | 'CHANNEL' | 'FULL_PAGE'>({
      query: (placement) => `/advertisements/interstitial/${placement}`,
      transformResponse: (response: ApiResponse<Advertisement | null>) => unwrapApiResponse(response),
      providesTags: [{ type: 'Advertisement', id: 'INTERSTITIAL' }],
    }),
    getAdUnlock: builder.query<AdUnlock | null, void>({
      query: () => '/advertisements/unlock',
      transformResponse: (response: ApiResponse<AdUnlock | null>) => unwrapApiResponse(response),
      providesTags: [{ type: 'Advertisement', id: 'UNLOCK' }],
    }),
    completeAdUnlock: builder.mutation<AdUnlock, { advertisementId: string }>({
      query: (body) => ({ url: '/advertisements/unlock', method: 'POST', body }),
      transformResponse: (response: ApiResponse<AdUnlock>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Advertisement', id: 'UNLOCK' }],
    }),
    startAdViewSession: builder.mutation<AdViewSession, { advertisementId: string }>({
      query: (body) => ({ url: '/advertisements/session/start', method: 'POST', body }),
      transformResponse: (response: ApiResponse<AdViewSession>) => unwrapApiResponse(response),
    }),
    completeAdViewSession: builder.mutation<AdUnlock, string>({
      query: (sessionId) => ({ url: `/advertisements/session/${sessionId}/complete`, method: 'POST' }),
      transformResponse: (response: ApiResponse<AdUnlock>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Advertisement', id: 'UNLOCK' }],
    }),
    cancelAdViewSession: builder.mutation<void, string>({
      query: (sessionId) => ({ url: `/advertisements/session/${sessionId}/cancel`, method: 'POST' }),
    }),
    createAdvertisement: builder.mutation<Advertisement, Omit<Advertisement, 'id'>>({
      query: (body) => ({ url: '/admin/advertisements', method: 'POST', body }), // Correct
      transformResponse: (response: ApiResponse<Advertisement>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Advertisement', id: 'LIST' }, { type: 'Advertisement', id: 'ACTIVE_LIST' }, { type: 'Advertisement', id: 'INTERSTITIAL' }],
    }),
    updateAdvertisement: builder.mutation<Advertisement, Partial<Advertisement> & Pick<Advertisement, 'id'>>({
      query: ({ id, ...body }) => ({ url: `/admin/advertisements/${id}`, method: 'PATCH', body }), // Correct
      transformResponse: (response: ApiResponse<Advertisement>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Advertisement', id }, { type: 'Advertisement', id: 'LIST' }, { type: 'Advertisement', id: 'ACTIVE_LIST' }, { type: 'Advertisement', id: 'INTERSTITIAL' }],
    }),
    deleteAdvertisement: builder.mutation<void, string>({
      query: (id) => ({ url: `/admin/advertisements/${id}`, method: 'DELETE' }), // Correct
      invalidatesTags: [{ type: 'Advertisement', id: 'LIST' }, { type: 'Advertisement', id: 'ACTIVE_LIST' }, { type: 'Advertisement', id: 'INTERSTITIAL' }],
    }),
  }),
});

export const { useGetAdvertisementsQuery, useGetActiveAdvertisementsQuery, useGetInterstitialAdvertisementQuery, useGetAdUnlockQuery, useCompleteAdUnlockMutation, useStartAdViewSessionMutation, useCompleteAdViewSessionMutation, useCancelAdViewSessionMutation, useCreateAdvertisementMutation, useUpdateAdvertisementMutation, useDeleteAdvertisementMutation } = advertisementsApi;