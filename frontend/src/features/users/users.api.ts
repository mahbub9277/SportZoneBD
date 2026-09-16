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

export const usersApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    updateMyProfile: builder.mutation<User, UpdateProfilePayload>({
      query: (body) => ({ url: '/settings/profile', method: 'PATCH', body }),
      transformResponse: (response: ApiResponse<User>) => unwrapApiResponse(response),
      // Invalidate the 'User' tag to refetch user data after update, consistent with auth.api.ts
      invalidatesTags: ['User'],
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
      async onQueryStarted(patch, { dispatch, queryFulfilled }) {
        const optimisticUpdate = dispatch(
          usersApi.util.updateQueryData('getNotificationPreferences', undefined, (draft) => {
            Object.assign(draft, patch)
          }),
        )
        try {
          await queryFulfilled
        } catch {
          optimisticUpdate.undo()
        }
      },
    }),
  }),
})

export const { useUpdateMyProfileMutation, useGetNotificationPreferencesQuery, useUpdateNotificationPreferencesMutation } = usersApi