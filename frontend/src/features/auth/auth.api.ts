import { emptyApi } from '../../app/api/emptyApi'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'
import { apiBaseUrl } from '../../app/api/baseQueryWithReauth'
import { toTransferPercent } from '../../utils/uploadProgress'
import type { LoginRequest, LoginResponse, RefreshResponse, User } from './auth.types'
import type { ApiResponse } from '../../app/api/types.ts'
import { unwrapApiResponse } from '../../app/api/api.utils'

/** The avatar upload reports transfer progress; any other profile update can just send the FormData. */
type UpdateProfileArgs = {
  formData: FormData
  onProgress?: (percent: number) => void
}
type VerifyEmailRequest = {
  email: string
  otp: string
}

type RegisterRequest = Record<string, unknown>;

const authApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation<LoginResponse, LoginRequest>({
      query: (credentials) => ({
        url: '/auth/login',
        method: 'POST',
        body: credentials,
      }),
      transformResponse: (response: ApiResponse<LoginResponse> | LoginResponse) => unwrapApiResponse<LoginResponse>(response),
      invalidatesTags: ['User'],
    }),
    adminLogin: builder.mutation<LoginResponse, LoginRequest>({
      query: (credentials) => ({
        url: '/auth/admin/login',
        method: 'POST',
        body: credentials,
      }),
      transformResponse: (response: ApiResponse<LoginResponse> | LoginResponse) => unwrapApiResponse<LoginResponse>(response),
      invalidatesTags: ['User'], // Invalidate user to refetch profile data
    }),
    refreshSession: builder.query<RefreshResponse, { includeUser?: boolean } | void>({
      query: (arg) => ({
        url: '/auth/refresh',
        method: 'POST',
        // Asking for the profile here is what lets the startup bootstrap restore the session in a
        // single round trip instead of refresh + /auth/me.
        body: arg ?? {},
      }),
      transformResponse: (response: ApiResponse<RefreshResponse> | RefreshResponse) => unwrapApiResponse<RefreshResponse>(response),
    }),
    register: builder.mutation<LoginResponse, RegisterRequest>({
      query: (credentials) => ({
        url: '/auth/register',
        method: 'POST',
        body: credentials,
      }),
      transformResponse: (response: ApiResponse<LoginResponse> | LoginResponse) => unwrapApiResponse<LoginResponse>(response),
      // No invalidatesTags here, as registration doesn't log the user in directly
    }),
    verifyEmail: builder.mutation<LoginResponse, VerifyEmailRequest>({
      query: (credentials) => ({
        url: '/auth/verify-email',
        method: 'POST',
        body: credentials,
      }),
      transformResponse: (response: ApiResponse<LoginResponse> | LoginResponse) => unwrapApiResponse<LoginResponse>(response),
      invalidatesTags: ['User'],
    }),
    resendOtp: builder.mutation<{ message: string }, { email: string }>({
      query: (credentials) => ({
        url: '/auth/resend-otp',
        method: 'POST',
        body: credentials,
      }),
    }),
    logout: builder.mutation<{ message: string }, void>({
      query: () => ({
        url: '/auth/logout',
        method: 'POST',
      }),
      invalidatesTags: ['User'],
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled
          dispatch(emptyApi.util.resetApiState())
        } catch {
          // Keep the current session cache if the server logout fails.
        }
      },
    }),
    // Renamed from getProfile to getMe for clarity and to match backend endpoint
    getMe: builder.query<User, void>({
      query: () => '/auth/me',
      transformResponse: (response: ApiResponse<User> | User) => unwrapApiResponse<User>(response),
      providesTags: ['User'],
    }),
    forgotPassword: builder.mutation<{ message: string }, { email: string }>({
      query: (credentials) => ({
        url: '/auth/forgot-password',
        method: 'POST',
        body: credentials,
      }),
    }),
    resetPassword: builder.mutation<{ message: string }, { email: string; otp: string; password: string }>({
      query: (credentials) => ({
        url: '/auth/reset-password',
        method: 'POST',
        body: credentials,
      }),
    }),
    updateProfile: builder.mutation<User, FormData | UpdateProfileArgs>({
      /**
       * The avatar is the one upload that still travels through the API (it is a user upload, not an
       * admin asset, and the server owns its validation and transformation). `fetchBaseQuery` cannot
       * report upload progress, so this single request is sent with `XMLHttpRequest`, which reports the
       * bytes as they leave the browser. Everything the shared base query does for it is preserved:
       * the API base URL, the HttpOnly cookie credentials, and a single refresh-and-retry on 401.
       */
      async queryFn(args, _api, _extraOptions, baseQuery) {
        const formData = args instanceof FormData ? args : args.formData
        const onProgress = args instanceof FormData ? undefined : args.onProgress

        const sendRequest = () => new Promise<{ status: number; body: unknown }>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PATCH', `${apiBaseUrl}/auth/profile`)
          xhr.withCredentials = true
          if (onProgress) {
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) onProgress(toTransferPercent(event.loaded, event.total))
            }
          }
          xhr.onload = () => {
            let body: unknown = null
            try {
              body = JSON.parse(xhr.responseText)
            } catch {
              body = null
            }
            resolve({ status: xhr.status, body })
          }
          xhr.onerror = () => reject(new Error('Could not reach the server. Check your connection and try again.'))
          xhr.ontimeout = () => reject(new Error('The upload timed out.'))
          xhr.onabort = () => reject(new Error('The upload was cancelled.'))
          xhr.send(formData)
        })

        let response: { status: number; body: unknown }
        try {
          response = await sendRequest()
          if (response.status === 401) {
            // The refresh token lives in an HttpOnly cookie, so the shared base query can rotate it.
            const refresh = await baseQuery({ url: '/auth/refresh', method: 'POST' })
            if (!refresh.error) response = await sendRequest()
          }
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: error instanceof Error ? error.message : 'Profile update failed.' } as FetchBaseQueryError }
        }

        if (response.status < 200 || response.status >= 300) {
          return { error: { status: response.status, data: response.body ?? { message: 'Profile update failed.' } } as FetchBaseQueryError }
        }

        const result = unwrapApiResponse<User | { user: User }>(response.body as ApiResponse<User | { user: User }>)
        return { data: 'user' in result ? result.user : result }
      },
      async onQueryStarted(_args, { dispatch, queryFulfilled }) {
        try {
          const { data: updatedUser } = await queryFulfilled
          dispatch(authApi.util.updateQueryData('getMe', undefined, (cachedUser) => {
            Object.assign(cachedUser, updatedUser)
          }))
        } catch {}
      },
    }),
  }),
  // This allows the authApi to be injected into the emptyApi without overwriting other endpoints
  overrideExisting: false,
}).enhanceEndpoints({
  addTagTypes: ['User'],
  endpoints: { getMe: { providesTags: ['User'] } },
});

// Export the auto-generated hook for the `login` mutation
export { authApi }
export const { useLoginMutation, useAdminLoginMutation, useRefreshSessionQuery, useRegisterMutation, useVerifyEmailMutation, useResendOtpMutation, useLogoutMutation, useForgotPasswordMutation, useResetPasswordMutation, useGetMeQuery, useUpdateProfileMutation } = authApi