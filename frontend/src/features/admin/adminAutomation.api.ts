import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'
import type {
  AutomationStatus,
  AutomationMetrics,
  AutomationLogsResponse,
} from './adminAutomation.types'

export const adminAutomationApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getAutomationStatus: builder.query<AutomationStatus, void>({
      query: () => '/admin/automation/status',
      transformResponse: (response: ApiResponse<AutomationStatus>) => unwrapApiResponse(response),
      providesTags: ['AutomationStatus'],
    }),

    triggerManualSync: builder.mutation<{ jobId: string }, void>({
      query: () => ({
        url: '/admin/automation/sync',
        method: 'POST',
      }),
      transformResponse: (response: ApiResponse<{ jobId: string }>) => unwrapApiResponse(response),
      invalidatesTags: ['AutomationStatus', 'AutomationLogs', 'AutomationMetrics'],
    }),

    getAutomationLogs: builder.query<
      AutomationLogsResponse,
      { page?: number; limit?: number; sort?: string }
    >({
      query: ({ page = 1, limit = 20, sort }) => ({
        url: '/admin/automation/logs',
        params: { page, limit, sort },
      }),
      transformResponse: (response: ApiResponse<AutomationLogsResponse>) => unwrapApiResponse(response),
      providesTags: ['AutomationLogs'],
    }),

    getAutomationMetrics: builder.query<AutomationMetrics, void>({
      query: () => '/admin/automation/metrics',
      transformResponse: (response: ApiResponse<AutomationMetrics>) => unwrapApiResponse(response),
      providesTags: ['AutomationMetrics'],
    }),

    deleteAutomationLog: builder.mutation<void, string>({
      query: (id) => ({ url: `/admin/automation/logs/${id}`, method: 'DELETE' }),
      // The backend returns 204 No Content, so no transformResponse is needed.
      invalidatesTags: ['AutomationLogs'],
    }),
  }),
})

export const {
  useGetAutomationStatusQuery,
  useTriggerManualSyncMutation,
  useGetAutomationLogsQuery,
  useGetAutomationMetricsQuery,
  useDeleteAutomationLogMutation,
} = adminAutomationApi

export type { AutomationLog, AutomationStatus, AutomationMetrics, AutomationLogsResponse } from './adminAutomation.types'
