import type { NextFunction, Response, RequestHandler } from 'express'

type AsyncRoute = (...args: any[]) => unknown

const asyncHandler = (fn: AsyncRoute): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

export default asyncHandler;