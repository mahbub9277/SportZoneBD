import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'
import type { User } from '../auth/auth.types'

interface UpdateProfilePayload {
  fullName?: string
}

export interface NotificationPreferences {
  id: string
  matchStartEmail: boolean
  matchStartPush: boolean
  newHighlightEmail: boolean
  newHighlightPush: boolean
  teamNewsEmail: boolean
  teamNewsPush: boolean
}

export const settingsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    updateMyProfile: builder.mutation<User, UpdateProfilePayload>({
      query: (body) => ({ url: '/settings/profile', method: 'PATCH', body }),
      transformResponse: (response: ApiResponse<User>) => unwrapApiResponse(response),
      // Invalidate the 'ME' tag to refetch user data after update
      invalidatesTags: ['ME'],
    }),
    getNotificationPreferences: builder.query<NotificationPreferences, void>({
      query: () => '/settings/notification-preferences',
      transformResponse: (response: ApiResponse<NotificationPreferences>) => unwrapApiResponse(response),
      providesTags: ['NotificationPreferences'],
    }),
    updateNotificationPreferences: builder.mutation<NotificationPreferences, Partial<NotificationPreferences>>({
      query: (body) => ({
        url: '/settings/notification-preferences',
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: ApiResponse<NotificationPreferences>) => unwrapApiResponse(response),
      invalidatesTags: ['NotificationPreferences'],
    }),
  }),
})

export const { useUpdateMyProfileMutation, useGetNotificationPreferencesQuery, useUpdateNotificationPreferencesMutation } = settingsApi