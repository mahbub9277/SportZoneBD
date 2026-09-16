import { emptyApi } from '../../app/api/emptyApi'
import type { User } from '../auth/auth.types'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse, PaginatedResult } from '../../app/api/types'
import type { UserFormValues } from '../../pages/admin/components/user.schema'

type GetUsersParams = {
  search?: string;
  page?: number;
  limit?: number;
  status?: string;
  sortBy?: string;
};

export const usersApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getUsers: builder.query<PaginatedResult<User>, GetUsersParams | void>({
      query: (params) => ({
        url: '/admin/users',
        params: params || {},
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<User>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [
              ...result.items.map(({ id }) => ({ type: 'User' as const, id })),
              { type: 'User', id: 'LIST' },
            ]
          : [{ type: 'User', id: 'LIST' }],
    }),
    getPremiumUsers: builder.query<PaginatedResult<User>, GetUsersParams | void>({
      query: (params) => ({
        url: '/admin/users/premium',
        params: params || {},
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<User>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'User' as const, id })), { type: 'User', id: 'LIST' }]
          : [{ type: 'User', id: 'LIST' }],
    }),
    createUser: builder.mutation<User, UserFormValues>({
      query: (newUser) => ({
        url: '/admin/users',
        method: 'POST',
        body: newUser,
      }),
      transformResponse: (response: ApiResponse<User>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'User', id: 'LIST' }],
    }),
    updateUser: builder.mutation<User, Partial<User> & Pick<User, 'id'>>({
      query: ({ id, ...patch }) => ({
        url: `/admin/users/${id}`,
        method: 'PATCH',
        body: patch,
      }),
      transformResponse: (response: ApiResponse<User>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'User', id }, { type: 'User', id: 'LIST' }],
    }),
    deleteUser: builder.mutation<void, string>({
      query: (id) => ({
        url: `/admin/users/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, id) => [{ type: 'User', id }, { type: 'User', id: 'LIST' }, { type: 'User', id: 'ARCHIVED_LIST' }],
    }),
    suspendUser: builder.mutation<User, string>({
      query: (id) => ({
        url: `/admin/users/${id}/suspend`,
        method: 'PATCH',
      }),
      transformResponse: (response: ApiResponse<User>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, id) => [{ type: 'User', id }, { type: 'User', id: 'LIST' }, { type: 'User', id: 'ARCHIVED_LIST' }],
    }),
    unsuspendUser: builder.mutation<User, string>({
      query: (id) => ({
        url: `/admin/users/${id}/unsuspend`,
        method: 'PATCH',
      }),
      transformResponse: (response: ApiResponse<User>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, id) => [{ type: 'User', id }, { type: 'User', id: 'LIST' }, { type: 'User', id: 'ARCHIVED_LIST' }],
    }),
    getArchivedUsers: builder.query<PaginatedResult<User>, GetUsersParams | void>({
      query: (params) => ({
        url: '/admin/users/archived',
        params: params || {},
      }),
      transformResponse: (response: ApiResponse<PaginatedResult<User>>) => unwrapApiResponse(response),
      providesTags: (result) =>
        result?.items
          ? [...result.items.map(({ id }) => ({ type: 'User' as const, id, list: 'ARCHIVED' })), { type: 'User', id: 'ARCHIVED_LIST' }]
          : [{ type: 'User', id: 'ARCHIVED_LIST' }],
    }),
    restoreUser: builder.mutation<User, string>({
      query: (id) => ({ url: `/admin/users/${id}/restore`, method: 'PATCH' }),
      transformResponse: (response: ApiResponse<User>) => unwrapApiResponse(response),
      invalidatesTags: (_result, _error, id) => [{ type: 'User', id }, { type: 'User', id: 'LIST' }, { type: 'User', id: 'ARCHIVED_LIST' }],
    }),
    permanentlyDeleteUser: builder.mutation<void, string>({
      query: (id) => ({
        url: `/admin/users/${id}/permanent`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: 'User', id: 'ARCHIVED_LIST' }],
    }),
  }),
  // It's good practice to be explicit about not overriding existing endpoints.
  overrideExisting: false,
})

export const { useGetUsersQuery, useGetPremiumUsersQuery, useCreateUserMutation, useUpdateUserMutation, useDeleteUserMutation, useSuspendUserMutation, useUnsuspendUserMutation, useGetArchivedUsersQuery, useRestoreUserMutation, usePermanentlyDeleteUserMutation } = usersApi