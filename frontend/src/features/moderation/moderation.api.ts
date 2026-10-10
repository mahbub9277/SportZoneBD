import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult, PaginationMeta } from '../../app/api/types'

/**
 * The moderation console's data layer.
 *
 * Every endpoint here is enforced on the backend by the permission the console navigation uses, so a
 * console page never relies on being reachable to be allowed. Nothing in this file decides what a
 * moderator may do — it only asks, and reports what actually came back.
 */

export interface ModerationEvent {
  id: string
  action: string | null
  outcome: 'success' | 'failure'
  actorId: string | null
  actorName: string | null
  entityType: string | null
  entityId: string | null
  reason: string | null
  requestId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  details: Record<string, unknown> | null
  createdAt: string
  message: string
}

export interface ModerationSummary {
  window: { from: string; to: string }
  scope: { actorId: string | null; actorName: string | null }
  reports: {
    awaitingAction: number
    open: number
    inProgress: number
    resolved: number
    closed: number
    total: number
    resolvedByMe: number
  }
  payments: {
    awaitingReview: number
    approvedTotal: number
    rejectedTotal: number
    reviewedByMe: number
  }
  premium: { activeMembers: number; expiringWithin7Days: number }
  campaigns: {
    pushCampaigns: number
    pushQueuedRecipients: number
    emailCampaigns: number
    emailsSent: number
    emailsFailed: number
    basedOnCampaigns: number
    /** True when the sample limit was reached, so the totals describe the most recent campaigns only. */
    countIsCapped: boolean
  }
  activity: {
    recordedActions: number
    sessionCount: number
    exactSessionCount: number
    estimatedSessionCount: number
    totalSessionMs: number
    estimatedActiveMs: number
    lastSeenAt: string | null
    /** Per-action duration is not measured by the platform, and the interface says so. */
    actionDurationMeasured: boolean
  }
  recentEvents: ModerationEvent[]
}

export interface ModerationActivitySummary {
  totalItems: number
  successCount: number
  failureCount: number
  byAction: Array<{ action: string; label: string; count: number; failureCount: number }>
}

export interface ModerationActivityQuery {
  page?: number
  limit?: number
  scope?: 'me' | 'all'
  actorId?: string
  action?: string
  outcome?: 'success' | 'failure'
  entityType?: string
  search?: string
  from?: string
  to?: string
}

export interface ModerationSessionRecord {
  id: string
  moderator: { id: string; fullName: string }
  startedAt: string
  lastSeenAt: string
  endedAt: string
  endSource: 'logout' | 'expiry' | 'idle' | 'active'
  durationMs: number
  activeMs: number
  isEstimated: boolean
}

export interface ModerationSessionsResponse {
  items: ModerationSessionRecord[]
  window: { from: string; to: string }
  moderatorId: string | null
  idleTimeoutMs: number
  summary: {
    sessionCount: number
    exactSessionCount: number
    estimatedSessionCount: number
    totalDurationMs: number
    totalActiveMs: number
    lastSeenAt: string | null
    hasEstimatedSessions: boolean
    listedSessions: number
  }
}

export interface ModerationAuditOptions {
  actions: Array<{ value: string; label: string }>
  outcomes: Array<{ value: string; label: string }>
  entityTypes: string[]
  moderators: Array<{ id: string; fullName: string }>
}

export interface PushAudiencePreview {
  audiences: Array<{ audience: 'ALL' | 'PREMIUM' | 'FREE'; recipients: number; pushEligibleRecipients: number }>
  /** True only when the platform can observe real per-recipient delivery, which it cannot today. */
  deliveryConfirmationAvailable: boolean
}

export interface PushCampaignPayload {
  title: string
  body: string
  link?: string
  targetAudience: 'ALL' | 'PREMIUM' | 'FREE'
  channel: 'IN_APP' | 'PUSH' | 'BOTH'
}

export interface PushCampaignResult {
  campaignId: string
  auditEventId: string
  audience: string
  channel: string
  audienceSize: number
  pushEligibleRecipients: number
  queuedRecipients: number
  deliveryConfirmed: boolean
}

export interface PremiumMemberPayment {
  id: string
  amount: string
  currency: string
  status: string
  provider: string
  transactionId: string
  createdAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  rejectionReason: string | null
  verificationResult: string | null
  methodLabel: string
  isVerifiedPayment: boolean
  isUnsuccessfulPayment: boolean
}

export interface PremiumMemberRecord {
  subscriptionId: string
  member: {
    id: string
    fullName: string | null
    email: string | null
    avatar: string | null
    isActive: boolean
    isSuspended: boolean
  }
  plan: { id: string; name: string; price: string; durationDays: number; maxDevices: number } | null
  membership: {
    status: string
    startedAt: string
    expiresAt: string
    autoRenew: boolean
    isActive: boolean
  }
  latestPayment: PremiumMemberPayment | null
  paymentHistory: PremiumMemberPayment[]
  paymentSummary: { recorded: number; approved: number; rejected: number }
}

export interface PremiumMembersQuery {
  page?: number
  limit?: number
  search?: string
  status?: string
  planId?: string
}

export interface SendableEmailTemplate {
  id: string
  subject: string
  body: string
  targetAudience: 'ALL' | 'PREMIUM' | 'FREE'
  link: string | null
  enabled: boolean
  updatedAt: string
}

export interface EmailCampaignAudiences {
  maxRecipients: number
  audiences: Array<{ audience: 'ALL' | 'PREMIUM' | 'FREE'; recipients: number }>
}

export interface EmailCampaignResult {
  campaignId: string
  audience: string
  totalRecipients: number
  attempted: number
  sentCount: number
  failedCount: number
  skippedCount: number
  truncated: boolean
  failures: Array<{ email: string; reason: string }>
}

const emptyMeta: PaginationMeta = {
  totalItems: 0,
  itemCount: 0,
  itemsPerPage: 0,
  totalPages: 1,
  currentPage: 1,
}

const toPaginated = <T,>(response: ApiResponse<T[]> & { meta?: PaginationMeta }): PaginatedResult<T> => ({
  items: unwrapApiResponse<T[]>(response, []),
  meta: response.meta ?? emptyMeta,
})

export const moderationApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getModerationSummary: builder.query<ModerationSummary, void>({
      query: () => '/admin/moderation/summary',
      transformResponse: (response: ApiResponse<ModerationSummary>) => unwrapApiResponse<ModerationSummary>(response),
      providesTags: ['ActivityLog'],
    }),
    getModerationActivity: builder.query<
      { items: ModerationEvent[]; summary: ModerationActivitySummary },
      ModerationActivityQuery
    >({
      query: (params) => ({ url: '/admin/moderation/activity', params }),
      transformResponse: (response: ApiResponse<{ items: ModerationEvent[]; summary: ModerationActivitySummary }>) =>
        unwrapApiResponse<{ items: ModerationEvent[]; summary: ModerationActivitySummary }>(response, {
          items: [],
          summary: { totalItems: 0, successCount: 0, failureCount: 0, byAction: [] },
        }),
      providesTags: ['ActivityLog'],
    }),
    getModerationSessions: builder.query<
      ModerationSessionsResponse,
      { moderatorId?: string; from?: string; to?: string } | void
    >({
      query: (params) => ({ url: '/admin/moderation/sessions', params: params ?? {} }),
      transformResponse: (response: ApiResponse<ModerationSessionsResponse>) => unwrapApiResponse<ModerationSessionsResponse>(response),
      providesTags: ['ActivityLog'],
    }),
    getModerationAuditOptions: builder.query<ModerationAuditOptions, void>({
      query: () => '/admin/moderation/audit-options',
      transformResponse: (response: ApiResponse<ModerationAuditOptions>) => unwrapApiResponse<ModerationAuditOptions>(response),
      providesTags: ['ActivityLog'],
    }),
    getPushAudiencePreview: builder.query<PushAudiencePreview, void>({
      query: () => '/admin/moderation/push-audience',
      transformResponse: (response: ApiResponse<PushAudiencePreview>) => unwrapApiResponse<PushAudiencePreview>(response),
    }),
    sendPushCampaign: builder.mutation<PushCampaignResult, PushCampaignPayload>({
      query: (body) => ({ url: '/notifications/broadcast', method: 'POST', body }),
      transformResponse: (response: ApiResponse<PushCampaignResult>) => unwrapApiResponse<PushCampaignResult>(response),
      invalidatesTags: ['ActivityLog', 'Notifications'],
    }),
    getPremiumMembers: builder.query<PaginatedResult<PremiumMemberRecord>, PremiumMembersQuery>({
      query: (params) => ({ url: '/payments/premium-members', params }),
      transformResponse: (response: ApiResponse<PremiumMemberRecord[]> & { meta?: PaginationMeta }) =>
        toPaginated<PremiumMemberRecord>(response),
      providesTags: ['Payments'],
    }),
    getSendableEmailTemplates: builder.query<SendableEmailTemplate[], void>({
      query: () => '/admin/email-templates/sendable',
      transformResponse: (response: ApiResponse<SendableEmailTemplate[]>) => unwrapApiResponse<SendableEmailTemplate[]>(response, []),
      providesTags: ['EmailTemplate'],
    }),
    getEmailCampaignAudiences: builder.query<EmailCampaignAudiences, void>({
      query: () => '/admin/email-templates/campaign-audiences',
      transformResponse: (response: ApiResponse<EmailCampaignAudiences>) => unwrapApiResponse<EmailCampaignAudiences>(response),
    }),
    sendEmailCampaign: builder.mutation<EmailCampaignResult, { id: string }>({
      query: ({ id }) => ({ url: `/admin/email-templates/${id}/send`, method: 'POST' }),
      transformResponse: (response: ApiResponse<EmailCampaignResult>) => unwrapApiResponse<EmailCampaignResult>(response),
      invalidatesTags: ['ActivityLog', 'EmailTemplate'],
    }),
    /**
     * Reports that the console is still in use. The backend records the session's own activity time and
     * never extends the session, so this cannot keep a session alive.
     */
    recordSessionHeartbeat: builder.mutation<{ recordedAt: string }, void>({
      query: () => ({ url: '/auth/session/heartbeat', method: 'POST' }),
      transformResponse: (response: ApiResponse<{ recordedAt: string }>) =>
        unwrapApiResponse<{ recordedAt: string }>(response, { recordedAt: new Date().toISOString() }),
    }),
  }),
})

export const {
  useGetModerationSummaryQuery,
  useGetModerationActivityQuery,
  useGetModerationSessionsQuery,
  useGetModerationAuditOptionsQuery,
  useGetPushAudiencePreviewQuery,
  useSendPushCampaignMutation,
  useGetPremiumMembersQuery,
  useGetSendableEmailTemplatesQuery,
  useGetEmailCampaignAudiencesQuery,
  useSendEmailCampaignMutation,
  useRecordSessionHeartbeatMutation,
} = moderationApi
