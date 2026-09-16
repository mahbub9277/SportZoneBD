import { Router } from 'express'
import { getStreams, createStream, updateStream, deleteStream, getStreamById } from './streams.controller.js'
import { requireRole } from '../../core/middleware/index.js'
import { validateBody } from '../../core/validation.js'
import { z } from 'zod'

const optionalUrl = z.preprocess((value) => value === '' ? null : value, z.string().url().nullable().optional())
const streamSchema = z.object({
  matchId: z.string().uuid(),
  name: z.string().trim().min(2).max(80).default('Main stream'),
  logo: optionalUrl,
  sourceType: z.enum(['DIRECT_URL', 'CHANNEL']).default('DIRECT_URL'),
  channelId: z.preprocess((value) => value === '' ? null : value, z.string().uuid().nullable().optional()),
  primaryUrl: z.string().trim().max(2048).optional().or(z.literal('')),
  backupUrl: optionalUrl,
  enabled: z.preprocess((value) => typeof value === 'string' ? value.toLowerCase() === 'true' : value, z.boolean()).default(true),
  status: z.enum(['READY', 'LIVE', 'OFFLINE', 'ERROR']).default('READY'),
  quality: z.string().trim().min(1).max(32).default('auto'),
  activationMode: z.enum(['AUTOMATIC', 'MANUAL']).default('AUTOMATIC'),
  activationOffsetMinutes: z.preprocess((value) => Number(value ?? 0), z.number().int().min(0).max(10080)).default(0),
})

const streamsRouter = Router()

streamsRouter.use(requireRole('admin'))

streamsRouter.route('/')
  .get(getStreams)
  .post(validateBody(streamSchema), createStream)

streamsRouter.route('/:id')
  .get(getStreamById)
  .patch(validateBody(streamSchema.partial()), updateStream)
  .delete(deleteStream)

export { streamsRouter }