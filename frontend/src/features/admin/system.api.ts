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

export interface Backup {
  id: string
  fileName: string
  size: string // BigInt is serialized as a string
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  createdAt: string
}

export interface BackupDownload {
  fileName: string
  downloadUrl: string
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
    getBackups: builder.query<Backup[], void>({
      query: () => 'system/backups',
      transformResponse: (response: ApiResponse<Backup[]>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result
          ? [...result.map(({ id }) => ({ type: 'Backup' as const, id })), { type: 'Backup', id: 'LIST' }]
          : [{ type: 'Backup', id: 'LIST' }],
    }),
    createBackup: builder.mutation<Backup, void>({
      query: () => ({
        url: 'system/backups',
        method: 'POST',
      }),
      transformResponse: (response: ApiResponse<Backup>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Backup', id: 'LIST' }],
    }),
    getBackupDownload: builder.query<BackupDownload, string>({
      query: (id) => `system/backups/${id}/download`,
      transformResponse: (response: ApiResponse<BackupDownload>) => unwrapApiResponse(response),
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
  useGetBackupsQuery,
  useCreateBackupMutation,
  useLazyGetBackupDownloadQuery,
  useGetCloudinaryStorageUsageQuery,
} = systemApi