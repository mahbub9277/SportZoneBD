import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'
import type {
  AutomationStatus,
  AutomationMetrics,
  AutomationLogsResponse,
  AutomationLogRetentionResult,
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

    /**
     * Deletes the automation logs older than the retention window (30 days) in bounded batches.
     *
     * The status/quality of a log never matters — every status older than the cutoff is eligible. The
     * response carries what the database actually deleted, so a request that stops at the per-run ceiling is
     * reported as incomplete rather than as success.
     */
    deleteAutomationLogsOlderThanRetention: builder.mutation<AutomationLogRetentionResult, void>({
      query: () => ({ url: '/admin/automation/logs/retention', method: 'DELETE' }),
      transformResponse: (response: ApiResponse<AutomationLogRetentionResult>) => unwrapApiResponse(response),
      // The cleanup changes the log history, the status card that lists the latest logs and the metrics
      // computed from that history, so all three are refetched.
      invalidatesTags: ['AutomationStatus', 'AutomationLogs', 'AutomationMetrics'],
    }),
  }),
})

export const {
  useGetAutomationStatusQuery,
  useTriggerManualSyncMutation,
  useGetAutomationLogsQuery,
  useGetAutomationMetricsQuery,
  useDeleteAutomationLogMutation,
  useDeleteAutomationLogsOlderThanRetentionMutation,
} = adminAutomationApi

export type { AutomationLog, AutomationStatus, AutomationMetrics, AutomationLogsResponse, AutomationLogRetentionResult } from './adminAutomation.types'
