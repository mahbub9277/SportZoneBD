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
  verificationResult?: string | null
  subscriptionPlan?: { name: string }
}

/** The hosted checkout session the backend created with ZiniPay for one SportZoneBD payment. */
export interface HostedCheckoutSession {
  paymentId: string
  /** The official ZiniPay payment page. The only thing the browser is allowed to trust is the redirect. */
  paymentUrl: string
  amount: string
  currency: string
  planName: string
  /** How long the customer has before the invoice should be considered stale (minutes). */
  expiresInMinutes: number
}

/** `status` is the provider's own invoice state after a server-side check. */
export type HostedCheckoutStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN'

export interface HostedCheckoutState {
  status: HostedCheckoutStatus
  /** A sentence from the backend, safe to show as-is. */
  message: string
  payment: Payment
  /**
   * Whether this deployment offers the transaction-reference path. The page only shows that form when the
   * backend says the capability is switched on, so a customer is never offered an action that cannot work.
   */
  trxVerificationEnabled?: boolean
}

/**
 * The outcome of verifying the transaction reference a customer paid with.
 *
 * `activated` is true only when the provider confirmed *and permanently consumed* the transaction; anything
 * else keeps the customer informed without granting anything.
 */
export interface TransactionVerificationResult {
  paymentId: string
  activated: boolean
  status: 'CONFIRMED' | 'PENDING'
  message: string
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
    /**
     * Asks the backend to create (or reuse) a ZiniPay hosted payment session for a plan.
     *
     * The browser never sees the ZiniPay credentials and never builds the payment request: it receives the
     * official payment page URL and redirects to it.
     */
    startHostedCheckout: builder.mutation<HostedCheckoutSession, { subscriptionPlanId: string }>({
      query: (body) => ({ url: '/payments/checkout', method: 'POST', body }),
      transformResponse: (response: ApiResponse<HostedCheckoutSession>) => unwrapApiResponse(response),
    }),
    /**
     * Server-side verification of the invoice behind a payment.
     *
     * Called when the customer returns from ZiniPay (and again on request while the answer is pending). A
     * `COMPLETED` answer is the only thing that activates premium, and the premium state is refetched in the
     * same step so the membership UI updates immediately.
     */
    verifyHostedCheckout: builder.mutation<HostedCheckoutState, { paymentId: string }>({
      query: ({ paymentId }) => ({ url: `/payments/checkout/${paymentId}/verify`, method: 'POST' }),
      transformResponse: (response: ApiResponse<HostedCheckoutState>) => unwrapApiResponse(response),
      invalidatesTags: (result) => (result?.status === 'COMPLETED' ? ['Payments', 'ME'] : ['Payments']),
    }),
    /**
     * Asks the backend to verify the transaction reference the customer paid with.
     *
     * The browser sends only the reference: the amount, the plan and the ownership come from the stored payment
     * record, and the backend only activates premium if the provider confirms and consumes the transaction.
     */
    verifyPaymentTransaction: builder.mutation<TransactionVerificationResult, { paymentId: string; transactionId: string }>({
      query: ({ paymentId, transactionId }) => ({
        url: `/payments/${paymentId}/transaction-verification`,
        method: 'POST',
        body: { transactionId },
      }),
      transformResponse: (response: ApiResponse<TransactionVerificationResult>) => unwrapApiResponse(response),
      invalidatesTags: (result) => (result?.activated ? ['Payments', 'ME'] : ['Payments']),
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

export const { useGetSubscriptionPlansQuery, useStartHostedCheckoutMutation, useVerifyHostedCheckoutMutation, useVerifyPaymentTransactionMutation, useCompletePaymentMutation, useGetPaymentHistoryQuery, useClearPaymentHistoryMutation } = paymentApi