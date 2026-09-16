/**
 * A simple client-side logger that mimics a more robust logging service.
 * In a real application, this could be replaced with a service like Sentry,
 * LogRocket, or a custom logging endpoint.
 */

type LogLevel = 'info' | 'warn' | 'error'

const log = (level: LogLevel, message: string, data?: unknown): void => {
  console[level](`[${level.toUpperCase()}] ${message}`, data || '')
}

const logger = {
  info: (message: string, data?: unknown) => log('info', message, data),
  warn: (message: string, data?: unknown) => log('warn', message, data),
  error: (message: string, data?: unknown) => log('error', message, data),
}

export default logger