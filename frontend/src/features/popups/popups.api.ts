import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'
import type { Popup } from '../admin/popups.api'

export const publicPopupsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getActivePopups: builder.query<Popup[], void>({
      query: () => ({
        url: 'popups/active',
        method: 'GET',
      }),
      transformResponse: (response: ApiResponse<Popup[]>) => unwrapApiResponse(response),
      providesTags: ['Popup'],
    }),
  }),
})

export const { useGetActivePopupsQuery } = publicPopupsApi