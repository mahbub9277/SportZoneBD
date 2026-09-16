import type { NextFunction, Request, Response } from 'express'

/**
 * Middleware to transform incoming match data from FormData.
 * Specifically, it converts string representations of booleans ('true', 'false')
 * into actual boolean values.
 */
export const transformMatchData = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') {
    for (const field of ['premium']) {
      const value = req.body[field]
      if (typeof value === 'string') {
        req.body[field] = ['true', '1', 'on', 'yes'].includes(value.trim().toLowerCase())
      }
    }
  }

  next()
}