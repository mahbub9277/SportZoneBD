import { emptyApi } from '@/app/api/emptyApi'
import { unwrapApiResponse } from '@/app/api/api.utils'
import type { ApiResponse, PaginatedResult, PaginationMeta } from '@/app/api/types'

export type ReportCategory = 'Bug' | 'Playback' | 'Payment' | 'Account' | 'Content'
export type ReportStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'

/**
 * A move the backend would accept for a report.
 *
 * The rules live in one place — the server — and are returned with the report itself, so the interface
 * offers exactly the transitions the API enforces and knows which of them need a reason.
 */
export interface ReportTransition {
  status: ReportStatus
  requiresReason: boolean
}

export interface ReportModerationEvent {
  id: string
  action: string | null
  outcome: 'success' | 'failure'
  actorId: string | null
  actorName: string | null
  reason: string | null
  before: { status?: string } | null
  after: { status?: string } | null
  createdAt: string
}

export interface ReportItem {
  id: string
  category: ReportCategory
  summary: string
  details: string
  status: ReportStatus
  createdAt: string
  /** Which moves are allowed from the current status, and which of them need a note. */
  allowedTransitions?: ReportTransition[]
  user?: {
    id: string
    fullName?: string | null
    email?: string | null
  }
}

export type ReportDetail = ReportItem & { history: ReportModerationEvent[] }

interface CreateReportPayload {
  category: ReportCategory
  summary: string
  details: string
}

interface UpdateReportStatusPayload {
  id: string
  status: ReportStatus
  /** Required for the moves the backend marks as needing one, for example closing a report. */
  reason?: string
}

export interface AdminReportsQuery {
  category?: ReportCategory
  status?: ReportStatus
  search?: string
}

export interface ModerationReportsQuery extends AdminReportsQuery {
  page?: number
  limit?: number
  from?: string
  to?: string
}

const emptyMeta: PaginationMeta = {
  totalItems: 0,
  itemCount: 0,
  itemsPerPage: 0,
  totalPages: 1,
  currentPage: 1,
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
    /** The same queue, paged, with the total the page actually came from. */
    getModerationReports: builder.query<PaginatedResult<ReportItem>, ModerationReportsQuery>({
      query: (params) => ({ url: '/reports/admin', params }),
      transformResponse: (response: ApiResponse<ReportItem[]> & { meta?: PaginationMeta }) => ({
        items: unwrapApiResponse<ReportItem[]>(response, []),
        meta: response.meta ?? emptyMeta,
      }),
      providesTags: ['Reports'],
    }),
    /** One report with the moderation actions already recorded against it. */
    getReportDetail: builder.query<ReportDetail, string>({
      query: (id) => `/reports/admin/${id}`,
      transformResponse: (response: ApiResponse<ReportDetail>) => unwrapApiResponse<ReportDetail>(response),
      providesTags: ['Reports'],
    }),
    updateReportStatus: builder.mutation<ReportItem, UpdateReportStatusPayload>({
      query: ({ id, status, reason }) => ({
        url: `/reports/${id}/status`,
        method: 'PATCH',
        body: { status, ...(reason ? { reason } : {}) },
      }),
      transformResponse: (response: ApiResponse<ReportItem> | ReportItem) => unwrapApiResponse<ReportItem>(response),
      invalidatesTags: ['Reports', 'ActivityLog'],
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
export const {
  useCreateReportMutation,
  useGetMyReportsQuery,
  useGetAdminReportsQuery,
  useGetModerationReportsQuery,
  useGetReportDetailQuery,
  useUpdateReportStatusMutation,
} = reportsApi
