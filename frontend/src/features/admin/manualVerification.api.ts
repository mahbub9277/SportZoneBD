import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

interface PendingPayment {
  id: string
  amount: number
  currency: string
  transactionId: string
  createdAt: string
  provider: string
  subscriptionPlan?: { name: string; price: number; durationDays: number } | null
  user: {
    fullName: string
    email: string
  }
}

type ProcessVerificationPayload = {
  paymentId: string
  action: 'approve' | 'reject'
  rejectionReason?: string
}

export const manualVerificationApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getPendingVerifications: builder.query<PendingPayment[], void>({
      query: () => 'payments/manual-verification',
      transformResponse: (response: ApiResponse<PendingPayment[]>) => unwrapApiResponse(response),
      providesTags: ['ManualVerification'],
    }),
    processVerification: builder.mutation<void, ProcessVerificationPayload>({
      query: ({ paymentId, action, rejectionReason }) => ({ url: `payments/manual-verification/${paymentId}`, method: 'PATCH', body: { action, rejectionReason } }),
      invalidatesTags: ['ManualVerification', 'Payments', 'AdminStats', 'AdminChartData', 'AdminPayments'],
    }),
  }),
})

export const { useGetPendingVerificationsQuery, useProcessVerificationMutation } = manualVerificationApi