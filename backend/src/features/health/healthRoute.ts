import { Router, type Router as ExpressRouter } from 'express'

export const healthRouter: ExpressRouter = Router()

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'sportzonebd-api' })
})
