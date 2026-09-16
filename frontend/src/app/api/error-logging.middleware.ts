import { isRejectedWithValue, type Middleware } from '@reduxjs/toolkit'
import { toast } from 'sonner'
import logger from '../../core/logger'

const SENSITIVE_KEY_PATTERN = /password|token|secret|ssn|creditcard|cardnumber|cvv/i
const shownErrorIds = new Set<string>()

const getUserFacingMessage = (status: unknown, data: unknown) => {
  if (typeof data === 'string' && data.trim()) return data
  if (data && typeof data === 'object') {
    const response = data as { message?: unknown; error?: unknown }
    const message = response.message ?? response.error
    if (typeof message === 'string' && message.trim()) return message
  }
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (typeof status === 'number' && status >= 500) return 'The server is unavailable right now. Please try again shortly.'
  return 'Something went wrong. Please try again.'
}

const sanitizeArgs = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeArgs)
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, argValue]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeArgs(argValue),
    ]),
  )
}

/**
 * This middleware logs RTK Query errors to our structured logging service.
 * It captures the endpoint, arguments, request ID, and the error payload for easier debugging.
 */
export const rtkQueryErrorLogger: Middleware = () => (next) => (action) => {
  if (isRejectedWithValue(action)) {
    const metaArg = action.meta.arg as { endpointName?: string; originalArgs?: unknown } | undefined
    const endpointName = metaArg?.endpointName
    const originalArgs = metaArg?.originalArgs
    const payload = action.payload as { status?: unknown; data?: unknown }
    const status = payload?.status
    const data = payload?.data
    const isAuthSessionRequest = endpointName === 'getMe' || endpointName === 'refresh'
    const isExpectedGuestAuthFailure = status === 401 && isAuthSessionRequest

    const logPayload: Record<string, unknown> = {
      actionType: action.type,
      endpoint: endpointName,
      requestId: action.meta.requestId,
      args: sanitizeArgs(originalArgs),
      error: {
        status,
        data: sanitizeArgs(data),
      },
    }

    const isServerError = typeof status === 'number' && status >= 500
    if (isServerError) {
      logger.error('RTK Query request failed with server error', logPayload)
    } else {
      logger.warn('RTK Query request failed', logPayload)
    }

    if (isExpectedGuestAuthFailure) {
      return next(action)
    }

    const errorId = `${action.meta.requestId}:${String(status)}`
    if (!shownErrorIds.has(errorId)) {
      shownErrorIds.add(errorId)
      toast.error(getUserFacingMessage(status, data), {
        id: `api-error-${errorId}`,
        duration: isServerError ? 6000 : 4500,
      })
      if (shownErrorIds.size > 100) {
        const oldestErrorId = shownErrorIds.values().next().value
        if (typeof oldestErrorId === 'string') shownErrorIds.delete(oldestErrorId)
      }
    }
  }

  return next(action)
}
