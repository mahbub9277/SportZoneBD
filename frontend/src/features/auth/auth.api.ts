import { emptyApi } from '../../app/api/emptyApi'
import type { LoginRequest, LoginResponse, User } from './auth.types'
import type { ApiResponse } from '../../app/api/types.ts'
import { unwrapApiResponse } from '../../app/api/api.utils'
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
    updateProfile: builder.mutation<User, FormData>({
      query: (formData) => ({
        url: '/auth/profile',
        method: 'PATCH',
        body: formData,
        // When using FormData, the browser automatically sets the 'Content-Type'
        // to 'multipart/form-data' with the correct boundary.
      }),
      transformResponse: (response: ApiResponse<User> | User) => unwrapApiResponse<User>(response),
      invalidatesTags: ['User'],
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
export const { useLoginMutation, useAdminLoginMutation, useRegisterMutation, useVerifyEmailMutation, useResendOtpMutation, useLogoutMutation, useForgotPasswordMutation, useResetPasswordMutation, useGetMeQuery, useUpdateProfileMutation } = authApi