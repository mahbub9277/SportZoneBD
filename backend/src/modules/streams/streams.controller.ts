import type { Request, Response, NextFunction } from 'express'
import * as streamsService from './streams.service.js'
import { successResponse } from '../../core/api-response.js'
import { NotFoundError } from '../../core/errors.js'
import { invalidateTags } from '../../core/cache.js'
import { emitAdminResourceCreated, emitAdminResourceUpdated, emitAdminResourceDeleted } from '../../core/socketManager.js'
import type { StreamStatus } from '@prisma/client'

export async function getStreams(req: Request, res: Response, next: NextFunction) {
  try {
    const query = {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 10,
      sortBy: (req.query.sortBy as string) || 'createdAt:desc',
      search: req.query.search as string,
    }
    const result = await streamsService.listStreams(query)
    return res.status(200).json(successResponse(result))
  } catch (error) {
    next(error)
  }
}

export async function getStreamById(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id)
    const stream = await streamsService.getStream(id)

    if (!stream || stream.deletedAt) {
      throw new NotFoundError('Stream not found')
    }

    return res.json(successResponse(stream))
  } catch (error) {
    next(error)
  }
}

export async function createStream(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = req.body as {
      matchId: string
      name: string
      logo?: string | null
      primaryUrl: string
      backupUrl?: string
      enabled?: boolean
      status?: StreamStatus
      quality?: string
    }

    const stream = await streamsService.createStream(payload)
    await invalidateTags(['streams', 'matches'])
    
    // Emit real-time event to admin clients
    emitAdminResourceCreated('Stream', stream.id, {
      id: stream.id,
      name: stream.name,
      matchId: stream.matchId
    })
    
    return res.status(201).json(successResponse(stream, 'Stream created'))
  } catch (error) {
    next(error)
  }
}

export async function updateStream(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id)
    const payload = req.body as Partial<{
      matchId: string
      name: string
      logo?: string | null
      primaryUrl: string
      backupUrl?: string
      enabled?: boolean
      status?: StreamStatus
      quality?: string
    }>

    const stream = await streamsService.updateStream(id, payload)
    if (!stream) throw new NotFoundError('Stream not found')
    await invalidateTags(['streams', 'matches'])
    
    // Emit real-time event to admin clients
    emitAdminResourceUpdated('Stream', id, {
      id: stream.id,
      name: stream.name,
      matchId: stream.matchId
    })
    
    return res.json(successResponse(stream, 'Stream updated'))
  } catch (error) {
    next(error)
  }
}

export async function deleteStream(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id)
    const stream = await streamsService.removeStream(id)
    if (!stream) throw new NotFoundError('Stream not found')
    
    await invalidateTags(['streams', 'matches'])
    
    // Emit real-time event to admin clients
    emitAdminResourceDeleted('Stream', id)
    
    return res.json(successResponse({ id: stream.id }, 'Stream deleted'))
  } catch (error) {
    next(error)
  }
}
