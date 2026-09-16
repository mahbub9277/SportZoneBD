import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'
import type { Channel } from '../../shared/types'
import type { Match } from '../matches/matches.types'

export interface EventSummary {
  id: string
  name: string
  slug: string
  logo?: string | null
  isPremium: boolean
}

export interface EventDetail extends EventSummary {
  description?: string | null
  banner?: string | null
  status: 'ACTIVE' | 'INACTIVE'
  showInSidebar: boolean
  sortOrder: number
  eventChannels: Array<{ channel: Channel } | { channelId: string } | Channel>
  eventMatches: Array<{ match: Match } | { matchId: string } | Match>
}

export interface EventInput {
  name: string
  slug: string
  description?: string | null
  logo?: string | null
  banner?: string | null
  status: 'ACTIVE' | 'INACTIVE'
  showInSidebar: boolean
  sortOrder: number
  isPremium: boolean
  channelIds: string[]
  matchIds: string[]
}

export interface MediaAsset {
  id: string
  type: 'BANNER' | 'LOGO'
  url: string
  publicId: string
  fileName?: string | null
  mimeType?: string | null
  size?: number | null
  width?: number | null
  height?: number | null
  createdAt: string
}

export const eventsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getSidebarEvents: builder.query<EventSummary[], void>({
      query: () => '/events/sidebar',
      transformResponse: (response: ApiResponse<EventSummary[]>) => unwrapApiResponse(response),
      providesTags: [{ type: 'Events', id: 'SIDEBAR' }],
    }),
    getEventBySlug: builder.query<EventDetail, string>({
      query: (slug) => `/events/${slug}`,
      transformResponse: (response: ApiResponse<EventDetail>) => unwrapApiResponse(response),
      providesTags: (_result, _error, slug) => [{ type: 'Events', id: `SLUG:${slug}` }],
    }),
    getAdminEvents: builder.query<EventDetail[], void>({
      query: () => '/events/admin/list',
      transformResponse: (response: ApiResponse<EventDetail[]>) => unwrapApiResponse(response),
      providesTags: (result) => result
        ? [...result.map((event) => ({ type: 'Events' as const, id: event.id })), { type: 'Events' as const, id: 'LIST' }]
        : [{ type: 'Events', id: 'LIST' }],
    }),
    getMediaLibrary: builder.query<MediaAsset[], { type?: 'BANNER' | 'LOGO'; search?: string } | void>({
      query: (params) => ({ url: '/admin/media', params: params ?? undefined }),
      transformResponse: (response: ApiResponse<MediaAsset[]>) => unwrapApiResponse(response),
      providesTags: [{ type: 'Events', id: 'MEDIA' }],
    }),
    getMediaUsage: builder.query<{ count: number; events: Array<{ id: string; name: string; slug: string }> }, string>({
      query: (id) => `/admin/media/${id}/usage`,
      transformResponse: (response: ApiResponse<{ count: number; events: Array<{ id: string; name: string; slug: string }> }>) => unwrapApiResponse(response),
    }),
    deleteMedia: builder.mutation<void, string>({
      query: (id) => ({ url: `/admin/media/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Events', id: 'MEDIA' }],
    }),
    createEvent: builder.mutation<EventDetail, EventInput>({
      query: (body) => ({ url: '/events/admin', method: 'POST', body }),
      transformResponse: (response: ApiResponse<EventDetail>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Events', id: 'LIST' }, { type: 'Events', id: 'SIDEBAR' }],
    }),
    updateEvent: builder.mutation<EventDetail, { id: string; data: EventInput }>({
      query: ({ id, data }) => ({ url: `/events/admin/${id}`, method: 'PUT', body: data }),
      transformResponse: (response: ApiResponse<EventDetail>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Events', id: 'LIST' }, { type: 'Events', id: 'SIDEBAR' }, { type: 'Events', id }],
    }),
    reorderEvents: builder.mutation<EventDetail[], Array<{ id: string; sortOrder: number }>>({
      query: (body) => ({ url: '/events/admin/reorder', method: 'PATCH', body }),
      transformResponse: (response: ApiResponse<EventDetail[]>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Events', id: 'LIST' }, { type: 'Events', id: 'SIDEBAR' }],
    }),
    deleteEvent: builder.mutation<{ id: string }, string>({
      query: (id) => ({ url: `/events/admin/${id}`, method: 'DELETE' }),
      transformResponse: (response: ApiResponse<{ id: string }>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Events', id: 'LIST' }, { type: 'Events', id: 'SIDEBAR' }],
    }),
  }),
  overrideExisting: false,
})

export const {
  useGetSidebarEventsQuery,
  useGetEventBySlugQuery,
  useGetAdminEventsQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useReorderEventsMutation,
  useDeleteEventMutation,
  useGetMediaLibraryQuery,
  useGetMediaUsageQuery,
  useLazyGetMediaUsageQuery,
  useDeleteMediaMutation,
} = eventsApi
