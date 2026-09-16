import { emptyApi } from '@/app/api/emptyApi'
import { unwrapApiResponse } from '@/app/api/api.utils'
import type { ApiResponse } from '@/app/api/types'

export type ReportCategory = 'Bug' | 'Playback' | 'Payment' | 'Account' | 'Content'
export type ReportStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'

export interface ReportItem {
  id: string
  category: ReportCategory
  summary: string
  details: string
  status: ReportStatus
  createdAt: string
  user?: {
    id: string
    fullName?: string | null
    email?: string | null
  }
}

interface CreateReportPayload {
  category: ReportCategory
  summary: string
  details: string
}

interface UpdateReportStatusPayload {
  id: string
  status: ReportStatus
}

export interface AdminReportsQuery {
  category?: ReportCategory
  status?: ReportStatus
  search?: string
}

const reportsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    createReport: builder.mutation<ReportItem, CreateReportPayload>({
      query: (payload) => ({
        url: '/reports',
        method: 'POST',
        body: payload,
      }),
      transformResponse: (response: ApiResponse<ReportItem> | ReportItem) => unwrapApiResponse<ReportItem>(response),
      invalidatesTags: ['Reports'],
    }),
    getMyReports: builder.query<ReportItem[], void>({
      query: () => '/reports/me',
      transformResponse: (response: ApiResponse<ReportItem[]> | ReportItem[]) => unwrapApiResponse<ReportItem[]>(response),
      providesTags: ['Reports'],
    }),
    getAdminReports: builder.query<ReportItem[], AdminReportsQuery | void>({
      query: (params) => ({ url: '/reports/admin', params: params ?? {} }),
      transformResponse: (response: ApiResponse<ReportItem[]> | ReportItem[]) => unwrapApiResponse<ReportItem[]>(response),
      providesTags: ['Reports'],
    }),
    updateReportStatus: builder.mutation<ReportItem, UpdateReportStatusPayload>({
      query: ({ id, status }) => ({
        url: `/reports/${id}/status`,
        method: 'PATCH',
        body: { status },
      }),
      transformResponse: (response: ApiResponse<ReportItem> | ReportItem) => unwrapApiResponse<ReportItem>(response),
      invalidatesTags: ['Reports'],
    }),
  }),
  overrideExisting: false,
}).enhanceEndpoints({
  addTagTypes: ['Reports'],
  endpoints: {
    getMyReports: { providesTags: ['Reports'] },
    getAdminReports: { providesTags: ['Reports'] },
  },
})

export { reportsApi }
export const { useCreateReportMutation, useGetMyReportsQuery, useGetAdminReportsQuery, useUpdateReportStatusMutation } = reportsApi
