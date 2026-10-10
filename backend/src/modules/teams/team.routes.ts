import { Router } from 'express'
import { requirePermission } from '../../core/middleware/index.js'
import { searchTeamsController } from './team.controller.js'

const teamsRouter = Router()
// Searching teams is read-only fixture support, so it is granted with the moderator's
// project-management permissions rather than full admin authority.
teamsRouter.use(requirePermission('admin.teams.view'))
teamsRouter.get('/search', searchTeamsController)

export { teamsRouter }
