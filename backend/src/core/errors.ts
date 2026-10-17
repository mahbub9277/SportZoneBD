export class AppError extends Error {
  statusCode: number
  details?: unknown
  isOperational: boolean

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message)

    this.name = 'AppError'
    this.statusCode = statusCode || 500
    this.details = details
    this.isOperational = true // Mark as an operational error

    // Restore the prototype chain
    Object.setPrototypeOf(this, new.target.prototype)

    // Capture the stack trace, excluding the constructor call from it
    Error.captureStackTrace(this, this.constructor)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    }
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, message)
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message)
    this.name = 'ForbiddenError'
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'A required service is temporarily unavailable') {
    super(503, message)
    this.name = 'ServiceUnavailableError'
  }
}

/**
 * The HTTP stream relay is switched off, so no relayed resource may be fetched.
 *
 * Reported as 503 with the machine-readable code `STREAM_RELAY_DISABLED` (derived from this class name by
 * the error handler), which is what the player recognises instead of treating it as a provider outage.
 */
export class StreamRelayDisabledError extends ServiceUnavailableError {
  constructor(message = 'The relay for HTTP stream sources is disabled.') {
    super(message)
    this.name = 'StreamRelayDisabledError'
  }
}

/**
 * A failure that belongs to the upstream source rather than to this service: the provider refused,
 * could not be reached, or the production HTTPS-only policy rejected it.
 *
 * It is deliberately not a 500, so a source problem is never answered or logged as an internal server
 * error. The specific reason travels in `details` (which production never returns) so the upstream URL
 * is available while diagnosing without ever reaching a client.
 */
export class BadGatewayError extends AppError {
  constructor(message = 'The upstream source could not be served', details?: unknown) {
    super(502, message, details)
    this.name = 'BadGatewayError'
  }
}

export class PremiumRequiredError extends ForbiddenError {
  isPremiumLocked: boolean

  constructor(message = 'Subscription required to access this content') {
    super(message)
    this.name = 'PremiumRequiredError'
    this.isPremiumLocked = true
  }
}

export class PremiumDeviceLimitError extends AppError {
  constructor(maxDevices: number) {
    super(409, `Your Premium plan supports up to ${maxDevices} active devices.`, { maxDevices })
    this.name = 'PremiumDeviceLimitError'
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super(400, message)
    this.name = 'BadRequestError'
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details: unknown) {
    super(400, message, details)
    this.name = 'ValidationError'
  }
}
