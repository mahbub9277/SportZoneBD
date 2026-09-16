import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

export interface SubscriptionPlan {
  id: string
  name: string
  price: number
  durationDays: number
  maxDevices: number
  description: string | null
  status: string // This might not be used, but keeping for now.
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
}

export const subscriptionPlansApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getSubscriptionPlans: builder.query<SubscriptionPlan[], { includeDeleted?: boolean }>({
      query: ({ includeDeleted = false } = {}) => `subscriptions/plans?includeDeleted=${includeDeleted}`,
      transformResponse: (response: ApiResponse<SubscriptionPlan[]>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result
          ? [...result.map(({ id }) => ({ type: 'SubscriptionPlan' as const, id })), { type: 'SubscriptionPlan', id: 'LIST' }]
          : [{ type: 'SubscriptionPlan', id: 'LIST' }],
    }),
    createSubscriptionPlan: builder.mutation<SubscriptionPlan, Partial<SubscriptionPlan>>({
      query: (body) => ({ url: 'subscriptions/plans', method: 'POST', body }),
      transformResponse: (response: ApiResponse<SubscriptionPlan>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'SubscriptionPlan', id: 'LIST' }],
    }),
    updateSubscriptionPlan: builder.mutation<SubscriptionPlan, Partial<SubscriptionPlan> & { id: string }>({
      query: ({ id, ...body }) => ({ url: `subscriptions/plans/${id}`, method: 'PATCH', body }),
      transformResponse: (response: ApiResponse<SubscriptionPlan>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'SubscriptionPlan', id },
        { type: 'SubscriptionPlan', id: 'LIST' },
      ],
    }),
    deleteSubscriptionPlan: builder.mutation<void, string>({
      query: (id) => ({ url: `subscriptions/plans/${id}`, method: 'DELETE' }),
      // A DELETE request that returns 204 No Content doesn't need a transformResponse.
      invalidatesTags: [{ type: 'SubscriptionPlan', id: 'LIST' }],
    }),
    restoreSubscriptionPlan: builder.mutation<SubscriptionPlan, string>({
      query: (id) => ({ url: `subscriptions/plans/${id}/restore`, method: 'POST' }),
      transformResponse: (response: ApiResponse<SubscriptionPlan>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, id) => [
        { type: 'SubscriptionPlan', id },
        { type: 'SubscriptionPlan', id: 'LIST' },
      ],
    }),
    permanentlyDeleteSubscriptionPlan: builder.mutation<void, string>({
      query: (id) => ({ url: `subscriptions/plans/${id}/permanent`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'SubscriptionPlan', id: 'LIST' }],
    }),
  }),
})

export const {
  useGetSubscriptionPlansQuery, useCreateSubscriptionPlanMutation, useUpdateSubscriptionPlanMutation, useDeleteSubscriptionPlanMutation, useRestoreSubscriptionPlanMutation, usePermanentlyDeleteSubscriptionPlanMutation
} = subscriptionPlansApi