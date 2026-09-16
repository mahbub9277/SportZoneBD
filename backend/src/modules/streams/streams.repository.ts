import { prisma } from '../../core/prisma.js'
import type { Stream, StreamStatus } from '@prisma/client'

export const findStreams = (options = {}) => prisma.stream.findMany(options)

export const findStreamById = (id: string) =>
  prisma.stream.findUnique({
    where: { id },
    include: { match: true },
  })

export const createStream = (data: {
  matchId: string
  primaryUrl: string
  backupUrl?: string | null
  enabled?: boolean
  status?: StreamStatus
  quality?: string
}) =>
  prisma.stream.create({
    data,
  })

export const updateStream = (id: string, data: Partial<Stream>) =>
  prisma.stream.update({
    where: { id },
    data,
  })

export const deleteStream = (id: string) =>
  prisma.stream.update({
    where: { id },
    data: { deletedAt: new Date() },
  })
