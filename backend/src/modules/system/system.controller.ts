import type { Request, Response, NextFunction } from 'express'
import { getLogs } from './system.service.js'
import { getErrorMessage } from '../../core/utils/get-error-message.js'
import cloudinary from '../../lib/cloudinary.js'

const toNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0

export async function getCloudinaryStorageUsage(_req: Request, res: Response, next: NextFunction) {
  try {
    const usage = await cloudinary.api.usage()
    const storage = usage.storage ?? {}
    const bandwidth = usage.bandwidth ?? {}

    res.json({
      success: true,
      data: {
        provider: 'Cloudinary',
        storage: {
          usedBytes: toNumber(storage.usage),
          limitBytes: toNumber(storage.limit),
        },
        bandwidth: {
          usedBytes: toNumber(bandwidth.usage),
          limitBytes: toNumber(bandwidth.limit),
        },
        requests: toNumber(usage.requests),
        updatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    next(error)
  }
}

export async function getSystemLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = 1, limit = 10, level, search, startDate, endDate } = req.query
    const logs = await getLogs({
      page: Number(page),
      limit: Number(limit),
      level: level as string,
      search: search as string,
      startDate: startDate as string,
      endDate: endDate as string,
      kind: 'system',
    })
    res.json({ success: true, data: logs })
  } catch (error) {
    next(error)
  }
}

export async function getAuditLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = 1, limit = 10, level, search, startDate, endDate } = req.query
    const logs = await getLogs({
      page: Number(page),
      limit: Number(limit),
      level: level as string,
      search: search as string,
      startDate: startDate as string,
      endDate: endDate as string,
      kind: 'audit',
    })
    res.json({ success: true, data: logs })
  } catch (error) {
    next(error)
  }
}

export async function getActivityLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const { page = 1, limit = 10, level, search, startDate, endDate } = req.query
    const logs = await getLogs({
      page: Number(page),
      limit: Number(limit),
      level: level as string,
      search: search as string,
      startDate: startDate as string,
      endDate: endDate as string,
      kind: 'activity',
    })
    res.json({ success: true, data: logs })
  } catch (error) {
    next(error)
  }
}

