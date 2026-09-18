import { useEffect } from 'react'
import { useAppDispatch } from '../../app/hooks'
import { adminAutomationApi } from './adminAutomation.api'
import { useAutomationEvents } from '../../hooks/useSocket'
import type {
  AutomationLog, AutomationMetrics, AutomationStatus,
} from './adminAutomation.types' // Frontend RTK Query types
import type { SocketAutomationLog, SocketAutomationMetrics, SocketAutomationStatus } from '../../hooks/useSocket' // Socket payload types (mirroring backend)

const toIsoString = (value: Date | string | null | undefined) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * A custom hook that listens for real-time automation events via sockets
 * and updates the RTK Query cache accordingly. This provides a seamless
 * real-time experience on the automation dashboard.
 */
export function useRealtimeAutomationUpdates() {
  const dispatch = useAppDispatch()
  const { on } = useAutomationEvents()

  useEffect(() => {
    // Handler for status updates
    // The payload here is from the backend, which has Date objects for dates
    const handleStatusUpdate = (payload: SocketAutomationStatus) => {
      dispatch(
        adminAutomationApi.util.updateQueryData('getAutomationStatus', undefined, (draft) => {
          if (draft) {
            // Transform Date objects to ISO strings to match frontend type
            const transformedPayload: AutomationStatus = {
              ...payload,
              lastRunAt: toIsoString(payload.lastRunAt),
              nextRunAt: toIsoString(payload.nextRunAt),
              createdAt: toIsoString(payload.createdAt) ?? new Date(0).toISOString(),
              updatedAt: toIsoString(payload.updatedAt) ?? new Date(0).toISOString(),
              deletedAt: toIsoString(payload.deletedAt),
              logs: payload.logs // payload.logs contains items of type SocketAutomationLog
                .filter(
                (log): log is SocketAutomationLog & { status: Exclude<SocketAutomationLog['status'], 'SKIPPED'> } =>
                  log.status !== 'SKIPPED',
              ).map((log): AutomationLog => ({ // Explicitly type the mapped item as AutomationLog
                  ...log,
                  // Ensure 'details' conforms to Record<string, any> | null.
                  // JsonValue can be primitives or arrays, which are not assignable to Record<string, any>.
                  details: (log.details && typeof log.details === 'object' && !Array.isArray(log.details))
                    ? log.details as Record<string, unknown>
                    : null,
                  createdAt: toIsoString(log.createdAt) ?? new Date(0).toISOString(),
                  updatedAt: toIsoString(log.updatedAt) ?? new Date(0).toISOString(),
                })),
            };
            Object.assign(draft, transformedPayload);
          }
        }),
      )
    }

    // Handler for metrics updates
    // The payload here is from the backend, which has Date objects for dates
    const handleMetricsUpdate = (payload: SocketAutomationMetrics) => {
      dispatch(
        adminAutomationApi.util.updateQueryData('getAutomationMetrics', undefined, (draft) => {
          if (draft) {
            const transformedPayload: AutomationMetrics = {
              ...payload,
              lastRunAt: toIsoString(payload.lastRunAt),
            };
            Object.assign(draft, transformedPayload);
          }
        }),
      )
    }

    // Handler for new log entries
    const handleLogEntry = (payload: SocketAutomationLog) => {
      // If the log status is 'SKIPPED', we don't add it to the frontend's AutomationLog list
      // as AutomationLog type does not include 'SKIPPED' status.
      if (payload.status === 'SKIPPED') {
        return;
      }
      // dispatch(adminAutomationApi.util.invalidateTags(['AutomationLogs']))
      dispatch(
        adminAutomationApi.util.updateQueryData('getAutomationStatus', undefined, (draft) => {
          if (draft && draft.logs) {
            // Transform the incoming socket log to match the frontend type
            const newLog: AutomationLog = {
              ...payload, // Spread all properties from payload
              status: payload.status as Exclude<SocketAutomationLog['status'], 'SKIPPED'>, // Explicitly cast status to exclude 'SKIPPED'
              details: (payload.details && typeof payload.details === 'object' && !Array.isArray(payload.details))
                ? payload.details as Record<string, unknown>
                : null,
              createdAt: toIsoString(payload.createdAt) ?? new Date(0).toISOString(),
              updatedAt: toIsoString(payload.updatedAt) ?? new Date(0).toISOString(),
            };
            // Add the new log to the beginning of the array
            draft.logs.unshift(newLog);
            // Optional: Keep the list to a certain size, e.g., 100
            if (draft.logs.length > 100) {
              draft.logs.pop();
            }
          }
        }),
      )
    }

    // Subscribe to the events
    const unsubscribeStatus = on('automationStatusUpdate', handleStatusUpdate)
    const unsubscribeMetrics = on('automationMetricsUpdate', handleMetricsUpdate)
    const unsubscribeLogs = on('automationLogEntry', handleLogEntry)

    // Cleanup on unmount
    return () => {
      unsubscribeStatus()
      unsubscribeMetrics()
      unsubscribeLogs()
    }
  }, [dispatch, on])
}