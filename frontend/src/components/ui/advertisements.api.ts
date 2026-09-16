import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

export interface Advertisement {
  id: string
  title: string
  link: string
  imageUrl: string
  isActive: boolean
}

/**
 * User-facing API slice for fetching active advertisements.
 */
export const advertisementsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    /**
     * Fetches a list of currently active advertisements to be displayed to users.
     */
    getActiveAdvertisements: builder.query<Advertisement[], void>({
      query: () => '/advertisements/active',
      transformResponse: (response: ApiResponse<Advertisement[]>) => unwrapApiResponse(response),
      providesTags: [{ type: 'Advertisement', id: 'ACTIVE_LIST' }],
    }),
  }),
})

export const { useGetActiveAdvertisementsQuery } = advertisementsApi