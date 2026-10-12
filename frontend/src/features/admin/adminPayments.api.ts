import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import type { User } from '../auth/auth.types'

interface SubscriptionPlan {
  id: string
  name: string
}

interface Payment {
  id: string
  amount: number
  currency: string
  status: string
  createdAt: string
  provider: string
  user: Pick<User, 'id' | 'fullName' | 'email'>
  subscriptionPlan?: SubscriptionPlan | null
}

export type AdminPayment = Payment

interface GetPaymentsParams {
  page: number
  search?: string
  status?: string
}

/** The outcome of an administrator's recheck of a hosted payment, with references already masked. */
export interface HostedRecheckResult {
  outcome: 'PENDING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN'
  message: string
  paymentId: string
  /** False when the provider was not asked, so the admin is never shown a no-op as a result. */
  providerContacted: boolean
  paymentStatus: string
  evidence: {
    providerStatus: string | null
    invoiceReference: string | null
    transactionReference: string | null
    paymentMethod: string | null
    amount: number | null
    verifiedAt: string | null
    checkedAt: string
    checkCount: number
    lastFailure: { kind: string } | null
  } | null
}

const adminPaymentsApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getAdminPayments: builder.query<PaginatedResult<Payment>, GetPaymentsParams>({
      query: ({ page, search, status }) => {
        const params = new URLSearchParams({ page: String(page) })
        if (search) params.append('search', search)
        if (status) params.append('status', status)
        return `/admin/payments?${params.toString()}`
      },
      transformResponse: (response: ApiResponse<PaginatedResult<Payment>>) => unwrapApiResponse(response),
      providesTags: (result) => (result ? [{ type: 'Payments', id: 'LIST' }] : []),
    }),
    processAdminPayment: builder.mutation<Payment, { id: string; action: 'approve' | 'reject'; rejectionReason?: string }>({
      query: ({ id, action, rejectionReason }) => ({
        url: `/payments/manual-verification/${id}`,
        method: 'PATCH',
        body: { action, rejectionReason },
      }),
      transformResponse: (response: ApiResponse<Payment>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Payments', id: 'LIST' }, 'AdminPayments'],
    }),
    /**
     * Asks the backend to re-run the provider's own verification for a hosted payment.
     *
     * There is no approve action here on purpose: the backend can only report what the provider says, so the
     * UI must not imply an administrator can mark a payment as paid.
     */
    recheckHostedPayment: builder.mutation<HostedRecheckResult, { id: string }>({
      query: ({ id }) => ({
        url: `/payments/manual-verification/${id}/recheck`,
        method: 'POST',
      }),
      transformResponse: (response: ApiResponse<HostedRecheckResult>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Payments', id: 'LIST' }, 'AdminPayments', 'ME'],
    }),
  }),
})

export const { useGetAdminPaymentsQuery, useProcessAdminPaymentMutation, useRecheckHostedPaymentMutation } = adminPaymentsApi