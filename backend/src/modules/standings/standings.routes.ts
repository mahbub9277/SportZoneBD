import { Router } from 'express'
import { getStandings } from './standings.controller.js'

const standingsRouter = Router()

standingsRouter.get('/', getStandings)

export { standingsRouter }
