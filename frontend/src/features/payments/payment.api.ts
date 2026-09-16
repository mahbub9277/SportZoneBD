import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'
import type { SubscriptionPlan } from '../admin/subscriptionPlans.api'
import type { User } from '../auth/auth.types'

interface Payment {
  id: string
  amount: number
  currency: string
  status: string
  provider: string
  transactionId?: string | null
  createdAt: string
  subscriptionPlan?: { name: string }
}

interface ManualPaymentConfig {
  paymentNumber: string | null
}

interface ManualPaymentPayload {
  subscriptionPlanId: string;
  transactionId: string;
}

interface CompletePaymentPayload {
  paymentId: string;
}

export const paymentApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getSubscriptionPlans: builder.query<SubscriptionPlan[], void>({
      query: () => 'subscriptions/plans',
      // The backend returns { data: [...] }, so we unwrap it here.
      transformResponse: (response: { data: SubscriptionPlan[] }) => response.data,
      providesTags: (result) => (result ? [...result.map(({ id }) => ({ type: 'SubscriptionPlan' as const, id })), { type: 'SubscriptionPlan', id: 'LIST' }] : [{ type: 'SubscriptionPlan', id: 'LIST' }]),
    }),
    getManualPaymentConfig: builder.query<ManualPaymentConfig, void>({
      query: () => '/payments/manual-config',
      transformResponse: (response: ApiResponse<ManualPaymentConfig>) => unwrapApiResponse(response),
    }),
    submitManualPayment: builder.mutation<Payment, ManualPaymentPayload>({
      query: (body) => ({ url: '/payments/verify', method: 'POST', body }),
      transformResponse: (response: ApiResponse<Payment>) => unwrapApiResponse(response),
      invalidatesTags: ['Payments'],
    }),
    completePayment: builder.mutation<User, CompletePaymentPayload>({
      query: (body) => ({
        url: 'payments/complete',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['ME'], // Invalidate the user query to refetch and show premium status
    }),
    getPaymentHistory: builder.query<Payment[], void>({
      query: () => '/payments/history',
      transformResponse: (response: ApiResponse<Payment[]>) => unwrapApiResponse(response),
      providesTags: ['Payments'],
    }),
    clearPaymentHistory: builder.mutation<{ clearedCount: number }, void>({
      query: () => ({ url: '/payments/history', method: 'DELETE' }),
      transformResponse: (response: ApiResponse<{ clearedCount: number }>) => unwrapApiResponse(response),
      invalidatesTags: ['Payments'],
    }),
  }),
})

export const { useGetSubscriptionPlansQuery, useGetManualPaymentConfigQuery, useSubmitManualPaymentMutation, useCompletePaymentMutation, useGetPaymentHistoryQuery, useClearPaymentHistoryMutation } = paymentApi