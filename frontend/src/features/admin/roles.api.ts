import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

export interface Role {
  id: string
  name: string
  description?: string | null
  isSystem?: boolean
}

export interface Permission {
  id:string
  key: string
  description?: string | null
}

export const rolesApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getRoles: builder.query<Role[], void>({
      query: () => '/admin/roles',
      transformResponse: (response: ApiResponse<Role[]>) => unwrapApiResponse(response),
      providesTags: (result = []) => [
        ...result.map(({ id }) => ({ type: 'Role', id } as const)),
        { type: 'Role', id: 'LIST' },
      ],
    }),
    createRole: builder.mutation<Role, Omit<Role, 'id' | 'isSystem'>>({
      query: (newRole) => ({
        url: '/admin/roles',
        method: 'POST',
        body: newRole,
      }),
      transformResponse: (response: ApiResponse<Role>) => unwrapApiResponse(response),
      invalidatesTags: [{ type: 'Role', id: 'LIST' }],
    }),
    getPermissions: builder.query<Permission[], void>({
      query: () => '/admin/permissions',
      transformResponse: (response: ApiResponse<Permission[]>) => unwrapApiResponse(response),
      providesTags: ['Permissions'],
    }),
  }),
})

export const {
  useGetRolesQuery,
  useCreateRoleMutation,
  useGetPermissionsQuery,
} = rolesApi