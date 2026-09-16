import { emptyApi } from '../../app/api/emptyApi'
import type { User } from '../auth/auth.types'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import { unwrapApiResponse } from '../../app/api/api.utils'

interface DashboardStats {
  totalUsers: number
  totalMatches: number
  totalSubscriptions: number
  activeSubscriptions: number
  expiredSubscriptions: number
  premiumUsers: number
  totalRevenue: number
  liveMatches?: number
  totalLiveViewers: number
  pendingPayments?: number
  successfulPayments: number
  rejectedPayments: number
  failedPayments: number
  totalTransactions: number
  totalPlans: number
}

interface ChartData {
  revenue: { month: string; total: number }[]
  userSignups: { day: string; count: number }[]
}

export interface AdvertisementAnalytics {
  period: string
  totalEvents: number
  uniqueUsers: number
  impressions: number
  watchClicks: number
  sessionsStarted: number
  sessionsCompleted: number
  sessionsCancelled: number
  standardEvents: number
  premiumEvents: number
  guestEvents: number
}

export interface SiteSetting {
  id: string
  key: string
  value: string
  type: string
  description?: string | null
  createdAt?: string
  updatedAt?: string
}

/**
 * Consolidated API slice for all admin-related operations.
 */
export const adminApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getDashboardStats: builder.query<DashboardStats, void>({
      query: () => '/admin/dashboard/stats',
      providesTags: ['AdminStats'],
      transformResponse: (response: ApiResponse<DashboardStats>) => unwrapApiResponse(response),
    }),
    getRecentUsers: builder.query<User[], void>({
      query: () => '/admin/dashboard/recent-users',
      providesTags: (result) =>
        result
          ? [...result.map(({ id }) => ({ type: 'User' as const, id })), { type: 'User', id: 'LIST' }]
          : [{ type: 'User', id: 'LIST' }],
      transformResponse: (response: ApiResponse<User[]>) => unwrapApiResponse(response),
    }),
    getChartData: builder.query<ChartData, void>({
      query: () => '/admin/dashboard/chart-data',
      providesTags: (result) =>
        result
          ? ['AdminChartData']
          : [],
      transformResponse: (response: ApiResponse<ChartData>) => unwrapApiResponse(response),
    }),
    getAdvertisementAnalytics: builder.query<AdvertisementAnalytics, string>({
      query: (period) => `/admin/dashboard/advertisement-analytics?period=${period}`,
      providesTags: ['AdminStats'],
      transformResponse: (response: ApiResponse<AdvertisementAnalytics>) => unwrapApiResponse(response),
    }),
    getAdminSettings: builder.query<SiteSetting[], void>({
      query: () => '/admin/settings',
      providesTags: [{ type: 'AdminSettings', id: 'LIST' }],
      transformResponse: (response: ApiResponse<SiteSetting[]>) => unwrapApiResponse(response),
    }),
    upsertAdminSetting: builder.mutation<SiteSetting[], { key: string; value: string; type?: string; description?: string } | { key: string; value: string; type?: string; description?: string }[]>({
      query: (settingsToUpdate) => ({
        url: '/admin/settings',
        method: 'PATCH',
        body: Array.isArray(settingsToUpdate) ? settingsToUpdate : [settingsToUpdate],
      }),
      invalidatesTags: [{ type: 'AdminSettings', id: 'LIST' }],
      transformResponse: (response: ApiResponse<SiteSetting[]>) => unwrapApiResponse(response),
    }),
    deleteAdminSetting: builder.mutation<void, string>({
      query: (key) => ({
        url: `/admin/settings/${key}`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'AdminSettings', id: 'LIST' }],
    }),
  }),
})

export const {
  useGetDashboardStatsQuery,
  useGetRecentUsersQuery,
  useGetChartDataQuery,
  useGetAdvertisementAnalyticsQuery,
  useGetAdminSettingsQuery,
  useUpsertAdminSettingMutation,
  useDeleteAdminSettingMutation,
} = adminApi