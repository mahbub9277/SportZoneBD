import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

// Configure pino logger
/**
 * Fields that must never reach a log line, whatever logs them. Pino matches one path segment per
 * `*`, so each field is covered at the three shapes it is realistically logged in: on its own, one
 * level deep (a request body or job payload), and two levels deep (`req.body`).
 */
const LOG_SECRET_FIELDS = [
  'password',
  'otp',
  'verificationCode',
  'verificationOtp',
  'passwordResetCode',
  'passwordResetToken',
  'resetToken',
  'refreshToken',
  'accessToken',
] as const

const logger = pino({
  level: isProduction ? 'info' : 'debug',
  base: {
    service: 'sportzonebd-api',
  },
  // In development, use pino-pretty for human-readable logs
  // In production, log as JSON for machine-readability
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: { colorize: true, ignore: 'pid,hostname' },
      }
    : undefined,
  // Redact sensitive information from logs for security
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      ...LOG_SECRET_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
    ],
    censor: '[REDACTED]',
  },
})

export default logger