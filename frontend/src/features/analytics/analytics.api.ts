import { emptyApi } from '../../app/api/emptyApi';
import type { ApiResponse } from '../../app/api/types'
import { unwrapApiResponse } from '../../app/api/api.utils'

interface TrackEventPayload {
  type: string;
  entityId: string;
}

export interface StreamHealthSummary {
  totalActiveViewers: number
  healthyViewers: number
  bufferingViewers: number
  errorViewers: number
  healthPercentage: number | null
  bufferingPercentage: number | null
  topErroredStreams?: Array<{ resource: string; errorCount: number; activeViewers: number; counters?: Record<string, unknown> }>
}

export interface StreamHealthBucket {
  timestamp: number
  activeViewers?: number
  healthyViewers?: number
  bufferingViewers?: number
  errorViewers?: number
}

export const analyticsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    trackEvent: builder.mutation<void, TrackEventPayload>({
      query: (body) => ({ url: '/analytics/track', method: 'POST', body }),
    }),
    getStreamHealthSummary: builder.query<StreamHealthSummary, void>({
      query: () => '/analytics/telemetry/summary',
      transformResponse: (response: ApiResponse<StreamHealthSummary>) => unwrapApiResponse(response),
    }),
    getStreamHealthHistory: builder.query<StreamHealthBucket[], number>({
      query: (minutes) => `/analytics/telemetry/history?minutes=${minutes}`,
      transformResponse: (response: ApiResponse<StreamHealthBucket[]>) => unwrapApiResponse(response),
    }),
  }),
});

export const { useTrackEventMutation, useGetStreamHealthSummaryQuery, useGetStreamHealthHistoryQuery } = analyticsApi;