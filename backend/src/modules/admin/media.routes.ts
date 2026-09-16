import { Router } from 'express'
import { mediaController } from './media.controller.js'

const mediaRouter = Router()

mediaRouter.get('/', mediaController.listMedia)
mediaRouter.get('/:id/usage', mediaController.getMediaUsage)
mediaRouter.delete('/:id', mediaController.deleteMedia)

export { mediaRouter }
