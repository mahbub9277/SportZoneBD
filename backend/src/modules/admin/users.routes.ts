import { Router, type Router as ExpressRouter } from 'express'
import { validateBody } from '../../core/validation.js'
import { createUser, listUsers, updateUser, deleteUser, suspendUser, unsuspendUser, getArchivedUsers, restoreUser, permanentlyDeleteUser, updateUserSchema, getPremiumUsers } from './users.controller.js'

export const usersRouter: ExpressRouter = Router()

// This route must be before the /:id routes to be matched correctly
usersRouter.get('/premium', getPremiumUsers)
usersRouter.get('/archived', getArchivedUsers)

usersRouter.get('/', listUsers)

usersRouter.post('/', createUser)

usersRouter.patch('/:id', validateBody(updateUserSchema), updateUser)
usersRouter.delete('/:id', deleteUser)
usersRouter.delete('/:id/permanent', permanentlyDeleteUser) // New route for permanent deletion
usersRouter.patch('/:id/suspend', suspendUser)
usersRouter.patch('/:id/unsuspend', unsuspendUser)
usersRouter.patch('/:id/restore', restoreUser)
