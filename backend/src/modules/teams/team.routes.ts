import { Router } from 'express'
import { requireRole } from '../../core/middleware/index.js'
import { searchTeamsController } from './team.controller.js'

const teamsRouter = Router()
teamsRouter.use(requireRole(['admin', 'super_admin']))
teamsRouter.get('/search', searchTeamsController)

export { teamsRouter }
