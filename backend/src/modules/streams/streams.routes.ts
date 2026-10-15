import { Router } from 'express'
import { getStreams, createStream, updateStream, deleteStream, getStreamById } from './streams.controller.js'
import { requirePermission } from '../../core/middleware/index.js'
import { validateBody } from '../../core/validation.js'
import { streamSchema, streamUpdateSchema } from './stream.validator.js'

const streamsRouter = Router()

streamsRouter.use(requirePermission('admin.streams.manage'))

streamsRouter.route('/')
  .get(getStreams)
  .post(validateBody(streamSchema), createStream)

streamsRouter.route('/:id')
  .get(getStreamById)
  .patch(validateBody(streamUpdateSchema), updateStream)
  .delete(deleteStream)

export { streamsRouter }