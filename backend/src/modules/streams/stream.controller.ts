import { type Request, type Response, type NextFunction } from 'express'
import { successResponse } from '../../core/api-response.js'
import * as streamsService from './streams.service.js'
import { NotFoundError } from '../../core/errors.js';

export const getStreams = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 10,
      sortBy: (req.query.sortBy as string) || 'createdAt:desc',
      search: req.query.search as string,
    }
    const result = await streamsService.listStreams(query)
    res.status(200).json(successResponse(result))
  } catch (error) {
    next(error)
  }
}

export const createStream = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const newStream = await streamsService.createStream(req.body)
    res.status(201).json(successResponse(newStream, 'Stream created'))
  } catch (error) {
    next(error)
  }
}

export const updateStream = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    const updatedStream = await streamsService.updateStream(id, req.body)
    if (!updatedStream) throw new NotFoundError('Stream not found')
    res.status(200).json(successResponse(updatedStream, 'Stream updated'))
  } catch (error) {
    next(error)
  }
}

export const deleteStream = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params
    await streamsService.removeStream(id)
    res.status(200).json(successResponse(null, 'Stream deleted'))
  } catch (error) {
    next(error)
  }
}