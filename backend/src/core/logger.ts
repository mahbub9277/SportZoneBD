import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

// Configure pino logger
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
      '*.password', // Redact any field named 'password' at any nesting level
    ],
    censor: '[REDACTED]',
  },
})

export default logger