import type { NextFunction, Request, Response } from 'express'
import { ZodError, type ZodTypeAny } from 'zod'
import { ValidationError } from './errors.js'

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
