import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils';
import type { ApiResponse } from '../../app/api/types';
export interface PushNotificationTemplate {
  id: string
  title: string
  body: string
  targetAudience: 'ALL' | 'PREMIUM' | 'FREE'
  link?: string
  enabled: boolean
  createdAt?: string
  updatedAt?: string
}

export const pushNotificationsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getPushNotificationTemplates: builder.query<PushNotificationTemplate[], void>({
      query: () => '/admin/push-notification-templates',
      transformResponse: (response: ApiResponse<PushNotificationTemplate[]>) => (unwrapApiResponse(response) ?? []).map((template) => ({
        ...template,
        targetAudience: template.targetAudience === 'PREMIUM' || template.targetAudience === 'FREE' ? template.targetAudience : 'ALL',
      })),
      providesTags: (result = []) => [
        ...result.map(({ id }) => ({ type: 'PushTemplates', id } as const)),
        { type: 'PushTemplates', id: 'LIST' },
      ],
    }),
    createPushNotificationTemplate: builder.mutation<PushNotificationTemplate, Omit<PushNotificationTemplate, 'id'>>({
      query: (newTemplate) => ({
        url: '/admin/push-notification-templates',
        method: 'POST',
        body: newTemplate,
      }),
      transformResponse: (response: ApiResponse<PushNotificationTemplate>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'PushTemplates', id: 'LIST' }],
    }),
    updatePushNotificationTemplate: builder.mutation<PushNotificationTemplate, { id: string; body: Omit<PushNotificationTemplate, 'id' | 'createdAt' | 'updatedAt'> }>({
      query: ({ id, body }) => ({
        url: `/admin/push-notification-templates/${id}`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (response: ApiResponse<PushNotificationTemplate>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'PushTemplates', id: 'LIST' }],
    }),
    deletePushNotificationTemplate: builder.mutation<void, string>({
      query: (id) => ({
        url: `/admin/push-notification-templates/${id}`,
        method: 'DELETE',
      }),
      transformResponse: (response: ApiResponse<void>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'PushTemplates', id: 'LIST' }],
    }),
  }),
})

export const {
  useGetPushNotificationTemplatesQuery,
  useCreatePushNotificationTemplateMutation,
  useUpdatePushNotificationTemplateMutation,
  useDeletePushNotificationTemplateMutation,
} = pushNotificationsApi