import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

/**
 * The visitor-safe site settings, served by `GET /settings/public`.
 *
 * Only these two fields are exposed anonymously, and they are the whole payload the match page needs to
 * decide whether it should play the configured pre-kick-off video. The endpoint is cached server-side and
 * this query is only mounted while a match page is waiting for its broadcast.
 */
export interface PublicSiteSettings {
  prestartVideoUrl: string | null
  prestartVideoEnabled: boolean
}

const DEFAULT_PUBLIC_SITE_SETTINGS: PublicSiteSettings = {
  prestartVideoUrl: null,
  prestartVideoEnabled: true,
}

export const siteSettingsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getPublicSiteSettings: builder.query<PublicSiteSettings, void>({
      query: () => '/settings/public',
      transformResponse: (response: ApiResponse<Partial<PublicSiteSettings>>) => ({
        ...DEFAULT_PUBLIC_SITE_SETTINGS,
        ...unwrapApiResponse(response),
      }),
      // The admin settings mutation invalidates this tag, so the admin preview and the match page stay in sync.
      providesTags: [{ type: 'AdminSettings', id: 'LIST' }],
    }),
  }),
  overrideExisting: false,
})

export const { useGetPublicSiteSettingsQuery } = siteSettingsApi
