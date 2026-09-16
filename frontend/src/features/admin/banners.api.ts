import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

export interface Banner { id: string; title: string; subtitle?: string | null; type: 'IMAGE' | 'VIDEO'; imageUrl?: string | null; videoUrl?: string | null; posterUrl?: string | null; badge?: string | null; ctaText?: string | null; ctaUrl?: string | null; isActive: boolean; displayOrder: number; createdAt?: string; updatedAt?: string; deletedAt?: string | null }
export const bannersApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getActiveBanners: builder.query<Banner[], void>({ query: () => '/banners/active', transformResponse: (response: ApiResponse<Banner[]>) => unwrapApiResponse(response), providesTags: ['Banner'] }),
    getAdminBanners: builder.query<Banner[], void>({ query: () => '/admin/banners', transformResponse: (response: ApiResponse<Banner[]>) => unwrapApiResponse(response), providesTags: ['Banner'] }),
    createBanner: builder.mutation<Banner, Partial<Banner>>({ query: (body) => ({ url: '/admin/banners', method: 'POST', body }), transformResponse: (response: ApiResponse<Banner>) => unwrapApiResponse(response), invalidatesTags: ['Banner'] }),
    updateBanner: builder.mutation<Banner, Partial<Banner> & { id: string }>({ query: ({ id, ...body }) => ({ url: `/admin/banners/${id}`, method: 'PATCH', body }), transformResponse: (response: ApiResponse<Banner>) => unwrapApiResponse(response), invalidatesTags: ['Banner'] }),
    deleteBanner: builder.mutation<Banner, string>({ query: (id) => ({ url: `/admin/banners/${id}`, method: 'DELETE' }), transformResponse: (response: ApiResponse<Banner>) => unwrapApiResponse(response), invalidatesTags: ['Banner'] }),
    reorderBanners: builder.mutation<Banner[], Array<{ id: string; displayOrder: number }>>({ query: (body) => ({ url: '/admin/banners/reorder', method: 'PATCH', body }), transformResponse: (response: ApiResponse<Banner[]>) => unwrapApiResponse(response), invalidatesTags: ['Banner'] }),
  }),
})
export const { useGetActiveBannersQuery, useGetAdminBannersQuery, useCreateBannerMutation, useUpdateBannerMutation, useDeleteBannerMutation, useReorderBannersMutation } = bannersApi