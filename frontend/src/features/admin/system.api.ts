import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'

export interface SystemLog {
  id: string
  level: string
  message: string
  meta: object | null
  createdAt: string
}

export interface CloudinaryStorageUsage {
  provider: 'Cloudinary'
  storage: { usedBytes: number; limitBytes: number }
  bandwidth: { usedBytes: number; limitBytes: number }
  requests: number
  updatedAt: string
}

interface GetSystemLogsParams {
  page?: number
  limit?: number
  level?: string
  search?: string
  startDate?: string
  endDate?: string
}

export const systemApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getSystemLogs: builder.query<PaginatedResult<SystemLog>, GetSystemLogsParams>({
      query: (params) => ({
        url: 'system/logs',
        params,
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<SystemLog>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'SystemLog' as const, id })), { type: 'SystemLog', id: 'LIST' }]
          : [{ type: 'SystemLog', id: 'LIST' }],
    }),
    getAuditLogs: builder.query<PaginatedResult<SystemLog>, GetSystemLogsParams>({
      query: (params) => ({
        url: 'system/logs/audit',
        params,
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<SystemLog>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'SystemLog' as const, id })), { type: 'SystemLog', id: 'AUDIT_LIST' }]
          : [{ type: 'SystemLog', id: 'AUDIT_LIST' }],
    }),
    getActivityLogs: builder.query<PaginatedResult<SystemLog>, GetSystemLogsParams>({
      query: (params) => ({
        url: 'system/logs/activity',
        params,
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<SystemLog>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'SystemLog' as const, id })), { type: 'SystemLog', id: 'ACTIVITY_LIST' }]
          : [{ type: 'SystemLog', id: 'ACTIVITY_LIST' }],
    }),
    getCloudinaryStorageUsage: builder.query<CloudinaryStorageUsage, void>({
      query: () => 'system/storage-usage',
      transformResponse: (response: ApiResponse<CloudinaryStorageUsage>) => unwrapApiResponse(response),
    }),
  }),
})

export const {
  useGetSystemLogsQuery,
  useGetAuditLogsQuery,
  useGetActivityLogsQuery,
  useGetCloudinaryStorageUsageQuery,
} = systemApi