import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import type { Notification, NotificationType } from './notification.types'

export interface BroadcastNotificationInput {
  title: string
  body: string
  type?: NotificationType
  userId?: string
  link?: string
  targetAudience?: 'ALL' | 'PREMIUM' | 'FREE'
}

export const notificationsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getUnreadNotificationCount: builder.query<{ count: number }, void>({
      query: () => '/notifications/unread-count',
      transformResponse: (response: ApiResponse<{ count: number }>) =>
        unwrapApiResponse(response) ?? { count: 0 },
      // Use a specific tag for the count to avoid unnecessary refetches.
      providesTags: ['Notifications'],
    }),
      getNotifications: builder.query<PaginatedResult<Notification>, { page: number, limit?: number; unreadOnly?: boolean }>({
        query: ({ page, limit = 25, unreadOnly = false }) => `/notifications?page=${page}&limit=${limit}&unreadOnly=${unreadOnly}`,
      transformResponse: (response: ApiResponse<PaginatedResult<Notification>>) =>
        unwrapApiResponse(response) ?? { items: [], meta: { totalItems: 0, itemCount: 0, itemsPerPage: 25, totalPages: 1, currentPage: 1 } },
      // Safely provide tags for the list and individual items.
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'Notifications' as const, id })), { type: 'Notifications', id: 'LIST' }]
          : [{ type: 'Notifications', id: 'LIST' }],
    }),
    markNotificationAsRead: builder.mutation<void, string>({
      query: (notificationId) => ({
        url: `/notifications/${notificationId}/mark-as-read`,
        method: 'PATCH',
      }),
      // Invalidate the specific notification and the unread count.
      invalidatesTags: (_result, _error, notificationId) => ['Notifications', { type: 'Notifications', id: notificationId }, { type: 'Notifications', id: 'LIST' }],
      async onQueryStarted(_notificationId, { dispatch, queryFulfilled }) {
        // Optimistically update the unread count
        const countPatchResult = dispatch(
          notificationsApi.util.updateQueryData('getUnreadNotificationCount', undefined, (draft) => {
            draft.count = Math.max(0, draft.count - 1)
          }),
        )
        try {
          await queryFulfilled
        } catch {
          countPatchResult.undo()
        }
      },
    }),
    markAllNotificationsAsRead: builder.mutation<void, void>({
      query: () => ({
        url: '/notifications/mark-all-as-read',
        method: 'POST',
      }),
      invalidatesTags: [{ type: 'Notifications', id: 'LIST' }],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const countPatchResult = dispatch(
          notificationsApi.util.updateQueryData('getUnreadNotificationCount', undefined, (draft) => {
            draft.count = 0
          }),
        )
        const listPatchResult = dispatch(
          notificationsApi.util.updateQueryData('getNotifications', { page: 1, limit: 25, unreadOnly: true }, (draft) => {
            draft.items.forEach((notification) => {
              notification.isRead = true
            })
          }),
        )
        try {
          await queryFulfilled
        } catch {
          countPatchResult.undo()
          listPatchResult.undo()
        }
      },
    }),
    deleteNotification: builder.mutation<void, string>({
      query: (notificationId) => ({ url: `/notifications/${notificationId}`, method: 'DELETE' }),
      invalidatesTags: ['Notifications', { type: 'Notifications', id: 'LIST' }],
    }),
    deleteAllNotifications: builder.mutation<void, void>({
      query: () => ({ url: '/notifications', method: 'DELETE' }),
      invalidatesTags: ['Notifications', { type: 'Notifications', id: 'LIST' }],
    }),
    broadcastNotification: builder.mutation<{ createdCount: number }, BroadcastNotificationInput>({
      query: (body) => ({
        url: '/notifications/broadcast',
        method: 'POST',
        body,
      }),
      transformResponse: (response: ApiResponse<{ createdCount: number }>) => unwrapApiResponse(response) ?? { createdCount: 0 },
    }),
    registerPushSubscription: builder.mutation<{ success: boolean }, { endpoint: string; keys: { p256dh: string; auth: string } }>({
      query: (body) => ({
        url: '/notifications/push/register',
        method: 'POST',
        body,
      }),
      transformResponse: (response: ApiResponse<{ success: boolean }>) => unwrapApiResponse(response) ?? { success: false },
    }),
    unregisterPushSubscription: builder.mutation<{ success: boolean }, { endpoint: string }>({
      query: (body) => ({
        url: '/notifications/push/unregister',
        method: 'POST',
        body,
      }),
      transformResponse: (response: ApiResponse<{ success: boolean }>) => unwrapApiResponse(response) ?? { success: false },
    }),
  }),
  overrideExisting: false,
})

export const {
  useGetUnreadNotificationCountQuery,
  useGetNotificationsQuery,
  useMarkAllNotificationsAsReadMutation,
  useDeleteNotificationMutation,
  useDeleteAllNotificationsMutation,
  useMarkNotificationAsReadMutation,
  useBroadcastNotificationMutation,
  useRegisterPushSubscriptionMutation,
  useUnregisterPushSubscriptionMutation,
} = notificationsApi