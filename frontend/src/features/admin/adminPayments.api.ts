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
  user: Pick<User, 'id' | 'fullName' | 'email'>
  subscriptionPlan?: SubscriptionPlan | null
}

export type AdminPayment = Payment

interface GetPaymentsParams {
  page: number
  search?: string
  status?: string
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
  }),
})

export const { useGetAdminPaymentsQuery, useProcessAdminPaymentMutation } = adminPaymentsApi