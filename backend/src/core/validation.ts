import type { NextFunction, Request, Response } from 'express'
import { ZodError, z, type ZodTypeAny } from 'zod'
import { ValidationError } from './errors.js'

/**
 * Validates a UUID route/query parameter so malformed ids are rejected with a 400
 * instead of reaching the database and surfacing as a 500.
 */
export function parseUuidParam(value: unknown, label = 'id'): string {
  const result = z.string().uuid().safeParse(value)
  if (!result.success) throw new ValidationError(`Invalid ${label}`, result.error.format())
  return result.data
}

export function validateBody<TSchema extends ZodTypeAny>(schema: TSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body)
      next()
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        // Use safeParse to avoid another try-catch and get formatted errors
        const validationResult = schema.safeParse(req.body)
        const details = !validationResult.success ? validationResult.error.format() : undefined
        next(new ValidationError('Validation failed', details))
        return
      }

      next(error)
    }
  }
}
