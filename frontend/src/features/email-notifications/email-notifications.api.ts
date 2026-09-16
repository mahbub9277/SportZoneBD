import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

export interface EmailTemplate {
  id: string
  subject: string
  body: string
  targetAudience: 'ALL' | 'PREMIUM' | 'FREE'
  link?: string | null
  enabled: boolean
  createdAt: string
}

export type CreateEmailTemplateDto = Omit<EmailTemplate, 'id' | 'createdAt'>
export type UpdateEmailTemplateDto = Partial<CreateEmailTemplateDto>

export interface SendEmailTemplateResult {
  sentCount: number
  failedCount: number
}

export const emailNotificationsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getEmailTemplates: builder.query<EmailTemplate[], void>({
      query: () => '/admin/email-templates',
      transformResponse: (response: ApiResponse<EmailTemplate[]>) => (unwrapApiResponse(response) ?? []).map((template) => ({ ...template, targetAudience: template.targetAudience ?? 'ALL' })),
      providesTags: (result) =>
        result && Array.isArray(result)
          ? [...result.map(({ id }) => ({ type: 'EmailTemplate' as const, id })), { type: 'EmailTemplate' as const, id: 'LIST' }]
          : [{ type: 'EmailTemplate' as const, id: 'LIST' }],
    }),
    createEmailTemplate: builder.mutation<EmailTemplate, CreateEmailTemplateDto>({
      query: (body) => ({
        url: '/admin/email-templates',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'EmailTemplate' as const, id: 'LIST' }],
    }),
    updateEmailTemplate: builder.mutation<EmailTemplate, { id: string; body: UpdateEmailTemplateDto }>({
      query: ({ id, body }) => ({
        url: `/admin/email-templates/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'EmailTemplate', id }, { type: 'EmailTemplate', id: 'LIST' }],
    }),
    deleteEmailTemplate: builder.mutation<void, string>({
      query: (id) => ({
        url: `/admin/email-templates/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'EmailTemplate' as const, id: 'LIST' }],
    }),
    sendEmailTemplate: builder.mutation<SendEmailTemplateResult, { id: string }>({
      query: ({ id }) => ({ url: `/admin/email-templates/${id}/send`, method: 'POST' }),
      transformResponse: (response: ApiResponse<SendEmailTemplateResult>) => unwrapApiResponse(response),
    }),
  }),
})

export const {
  useGetEmailTemplatesQuery,
  useCreateEmailTemplateMutation,
  useUpdateEmailTemplateMutation,
  useDeleteEmailTemplateMutation,
  useSendEmailTemplateMutation,
} = emailNotificationsApi