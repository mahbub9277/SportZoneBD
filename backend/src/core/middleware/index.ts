export {
  authenticate,
  optionalProtect,
  authorize,
  requireRole,
  requirePermission,
  errorHandler,
  notFound, // Keep notFound
  getUserRoles, // Keep getUserRoles
} from '../middleware.js'
export type { AuthenticatedRequest } from '../middleware.js'
export { validateBody } from '../validation.js';