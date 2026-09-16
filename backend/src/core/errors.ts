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
