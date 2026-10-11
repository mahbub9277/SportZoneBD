import { emptyApi } from '../../app/api/emptyApi'
import { unwrapApiResponse } from '../../app/api/api.utils'
import type { ApiResponse } from '../../app/api/types'

export type AutomationSwitchKey = 'pushNotifications' | 'matchCreation'

/** What the subsystem needs in order to do useful work, reported next to the switch value. */
export interface AutomationSwitchDependency {
  name: string
  ok: boolean
  detail: string
}

/**
 * How far the change has got: persisted and applied to the instance that answered, persisted but not
 * operational because a dependency is missing, or not confirmed at all.
 */
export type AutomationTransition = 'applied' | 'degraded' | 'unavailable'

export interface AutomationSwitchState {
  key: AutomationSwitchKey
  settingKey: string
  label: string
  description: string
  /** Persisted value last confirmed by the backend, or null when it could not be established. */
  desired: boolean | null
  /** What the backend enforces right now; false whenever the value could not be confirmed. */
  operational: boolean
  degraded: boolean
  degradedReason: string | null
  confirmedAt: string | null
  /** Only the instance that answered is acknowledged; other instances follow within its cache window. */
  instancesConfirmed: 'this-instance-only'
  transition: AutomationTransition
  /** Only present on the response to an update: the value the change replaced. */
  previousValue?: boolean | null
  dependencies: AutomationSwitchDependency[]
  notes: string[]
}

export interface AutomationSwitchUpdate {
  enabled: boolean
}

export const automationSwitchesApi = emptyApi.injectEndpoints({
  endpoints: (builder) => ({
    getPushAutomationSwitch: builder.query<AutomationSwitchState, void>({
      query: () => '/admin/automation/push-notifications',
      transformResponse: (response: ApiResponse<AutomationSwitchState>) => unwrapApiResponse(response),
      providesTags: ['AutomationSwitches'],
    }),

    updatePushAutomationSwitch: builder.mutation<AutomationSwitchState, AutomationSwitchUpdate>({
      query: (body) => ({ url: '/admin/automation/push-notifications', method: 'PATCH', body }),
      transformResponse: (response: ApiResponse<AutomationSwitchState>) => unwrapApiResponse(response),
      invalidatesTags: ['AutomationSwitches', 'AutomationStatus', 'AutomationMetrics'],
    }),

    getMatchCreationSwitch: builder.query<AutomationSwitchState, void>({
      query: () => '/admin/automation/match-creation',
      transformResponse: (response: ApiResponse<AutomationSwitchState>) => unwrapApiResponse(response),
      providesTags: ['AutomationSwitches'],
    }),

    updateMatchCreationSwitch: builder.mutation<AutomationSwitchState, AutomationSwitchUpdate>({
      query: (body) => ({ url: '/admin/automation/match-creation', method: 'PATCH', body }),
      transformResponse: (response: ApiResponse<AutomationSwitchState>) => unwrapApiResponse(response),
      invalidatesTags: ['AutomationSwitches', 'AutomationStatus', 'AutomationMetrics'],
    }),
  }),
})

export const {
  useGetPushAutomationSwitchQuery,
  useUpdatePushAutomationSwitchMutation,
  useGetMatchCreationSwitchQuery,
  useUpdateMatchCreationSwitchMutation,
} = automationSwitchesApi
