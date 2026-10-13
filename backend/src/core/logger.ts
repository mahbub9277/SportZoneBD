import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

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
  'secret',
  'clientSecret',
  'apiSecret',
  'apiKey',
  'apikey',
  'api_key',
] as const

/**
 * Headers that carry a credential.
 *
 * Listed in the canonical lower-case form Node gives an incoming request, in the casing this codebase's own
 * outbound calls use (`zini-api-key`, `X-Auth-Token`, `x-apisports-key`) and in the title-case form
 * third-party clients commonly send, so a header is redacted whichever way it arrives or is written down.
 */
const LOG_SECRET_HEADERS = [
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'set-cookie',
  'Set-Cookie',
  'zini-api-key',
  'Zini-Api-Key',
  'zinipay-api-key',
  'Zinipay-Api-Key',
  'x-api-key',
  'X-Api-Key',
  'x-auth-token',
  'X-Auth-Token',
  'x-apisports-key',
  'X-Apisports-Key',
  'x-bkash-signature',
  'apikey',
] as const

/**
 * Every shape a credential header is realistically logged in.
 *
 * `req.headers[...]` is what a request logger writes, and the deeper paths cover the outgoing-call shapes: an
 * axios error logged as `{ error }` carries `error.config.headers[...]`, and one logged inside a job carries
 * another level above that. Bracket notation is how pino addresses a key containing dashes.
 */
const headerRedactionPaths = (name: string): string[] => [
  name,
  `headers['${name}']`,
  `req.headers['${name}']`,
  `res.headers['${name}']`,
  `*.headers['${name}']`,
  `*.*.headers['${name}']`,
  `*.*.*.headers['${name}']`,
]

/**
 * The redaction configuration, exported so it can be asserted in tests with a capturing stream instead of the
 * process's own stdout. Duplicates are removed so the same key is never listed twice through two paths.
 */
export const LOG_REDACT = {
  paths: [
    ...new Set([
      ...LOG_SECRET_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
      ...LOG_SECRET_HEADERS.flatMap(headerRedactionPaths),
    ]),
  ],
  censor: '[REDACTED]',
}

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
  redact: LOG_REDACT,
})

export default logger