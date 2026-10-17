import { emptyApi } from '../../app/api/emptyApi'
import type { User } from '../auth/auth.types'
import type { TeamReference } from '../matches/matches.types'
import type { ApiResponse } from '../../app/api/types'
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
  totalLiveViewers: number | null
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

export interface TeamSearchResult extends Omit<TeamReference, 'id'> {
  id: string | null
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

/** What the server reports about the HTTP stream relay, including whether it could confirm the value. */
export interface StreamRelaySettingStatus {
  settingKey: string
  label: string
  description: string
  /** Value the database holds, or null when the server could not read it. */
  desired: boolean | null
  /** Value the server enforces right now — fail closed, so false while the value is unknown. */
  operational: boolean
  degraded: boolean
  degradedReason: string | null
  confirmedAt: string | null
  activeRelayRequests?: number
  /** Echoed by the update endpoint: the value that was actually persisted. */
  enabled?: boolean
  previous?: boolean | null
}

/**
 * Consolidated API slice for all admin-related operations.
 */
export const adminApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    searchTeams: builder.query<TeamSearchResult[], string>({
      query: (query) => ({ url: '/teams/search', params: { q: query } }),
      transformResponse: (response: ApiResponse<TeamSearchResult[]>) => unwrapApiResponse(response),
    }),
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
    /**
     * The server-side HTTP stream relay switch.
     *
     * Its own endpoint rather than a generic setting: enabling and disabling it also stops or resumes relay
     * work on the server, so the response carries the state the database actually holds.
     */
    getStreamRelaySetting: builder.query<StreamRelaySettingStatus, void>({
      query: () => '/admin/settings/stream-relay',
      providesTags: [{ type: 'AdminSettings', id: 'STREAM_RELAY' }],
      transformResponse: (response: ApiResponse<StreamRelaySettingStatus>) => unwrapApiResponse(response),
    }),
    updateStreamRelaySetting: builder.mutation<StreamRelaySettingStatus, { enabled: boolean }>({
      query: (body) => ({ url: '/admin/settings/stream-relay', method: 'PATCH', body }),
      invalidatesTags: [{ type: 'AdminSettings', id: 'STREAM_RELAY' }],
      transformResponse: (response: ApiResponse<StreamRelaySettingStatus>) => unwrapApiResponse(response),
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
  useLazySearchTeamsQuery,
  useGetDashboardStatsQuery,
  useGetRecentUsersQuery,
  useGetChartDataQuery,
  useGetAdvertisementAnalyticsQuery,
  useGetAdminSettingsQuery,
  useUpsertAdminSettingMutation,
  useGetStreamRelaySettingQuery,
  useUpdateStreamRelaySettingMutation,
  useDeleteAdminSettingMutation,
} = adminApi