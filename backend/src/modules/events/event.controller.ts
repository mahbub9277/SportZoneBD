import type { Request, Response } from 'express'
import { z } from 'zod'
import asyncHandler from '../../utils/asyncHandler.js'
import { BadRequestError, NotFoundError } from '../../core/errors.js'
import { successResponse } from '../../core/api-response.js'
import { invalidateTags } from '../../core/cache.js'
import { emitAdminResourceCreated, emitAdminResourceDeleted, emitAdminResourceUpdated } from '../../core/socketManager.js'
import { hasPremiumAccess } from '../../core/premiumGuard.js'
import * as service from './event.service.js'
import { cleanupAssetIfUnused, cleanupReplacedAsset } from '../../services/asset-cleanup.service.js'

const eventSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must contain lowercase letters, numbers, and hyphens.'),
  description: z.string().trim().max(2000).optional().nullable(),
  logo: z.string().url().optional().nullable().or(z.literal('')),
  banner: z.string().url().optional().nullable().or(z.literal('')),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  showInSidebar: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  isPremium: z.boolean().default(false),
  channelIds: z.array(z.string().uuid()).default([]),
  matchIds: z.array(z.string().uuid()).default([]),
})

const parseBody = (body: unknown) => {
  const result = eventSchema.safeParse(body)
  if (!result.success) throw new BadRequestError(result.error.issues[0]?.message ?? 'Invalid event data.')
  return result.data
}

export const getSidebarEvents = asyncHandler(async (_req: Request, res: Response) => {
  const events = await service.getSidebarEvents()
  res.json(successResponse(events))
})

export const getEventBySlug = asyncHandler(async (req: Request, res: Response) => {
  const event = await service.getPublicEventBySlug(req.params.slug)
  if (!event) throw new NotFoundError('Event not found or is not active.')
  const hasPremiumContent = event.isPremium
    || event.eventChannels.some(({ channel }) => channel.isPremium)
    || event.eventMatches.some(({ match }) => match.premium)
  const canAccessPremium = hasPremiumContent ? await hasPremiumAccess(req, res) : true

  res.json(successResponse({
    ...event,
    eventChannels: event.eventChannels.map(({ channel }) => ({
      ...channel,
      url: !canAccessPremium && (event.isPremium || channel.isPremium) ? null : channel.url,
    })),
    eventMatches: event.eventMatches.map(({ match }) => ({
      ...match,
      streams: (!canAccessPremium && (event.isPremium || match.premium))
        ? match.streams.map((stream) => ({ ...stream, primaryUrl: '', backupUrl: null }))
        : match.streams,
    })),
  }))
})

export const getAdminEvents = asyncHandler(async (_req: Request, res: Response) => {
  res.json(successResponse(await service.getAdminEvents()))
})

export const getAdminEvent = asyncHandler(async (req: Request, res: Response) => {
  const event = await service.getAdminEvent(req.params.id)
  if (!event) throw new NotFoundError('Event not found.')
  res.json(successResponse(event))
})

export const createEvent = asyncHandler(async (req: Request, res: Response) => {
  const data = parseBody(req.body)
  const { channelIds, matchIds, ...eventData } = data
  const event = await service.createEvent({ ...eventData, logo: eventData.logo || null, banner: eventData.banner || null, description: eventData.description || null }, channelIds, matchIds)
  await invalidateTags(['events', 'event-sidebar'])
  emitAdminResourceCreated('Event', event.id, { id: event.id, name: event.name, slug: event.slug })
  res.status(201).json(successResponse(event, 'Event created successfully.'))
})

export const updateEvent = asyncHandler(async (req: Request, res: Response) => {
  const existing = await service.getAdminEvent(req.params.id)
  if (!existing) throw new NotFoundError('Event not found.')
  const data = parseBody(req.body)
  const { channelIds, matchIds, ...eventData } = data
  const event = await service.updateEvent(req.params.id, { ...eventData, logo: eventData.logo || null, banner: eventData.banner || null, description: eventData.description || null }, channelIds, matchIds)
  await Promise.all([
    cleanupReplacedAsset(existing.logo, event.logo),
    cleanupReplacedAsset(existing.banner, event.banner),
  ])
  await invalidateTags(['events', 'event-sidebar', `event:${req.params.id}`, `event:slug:${event.slug}`])
  emitAdminResourceUpdated('Event', event.id, { id: event.id, name: event.name, slug: event.slug })
  res.json(successResponse(event, 'Event updated successfully.'))
})

export const reorderEvents = asyncHandler(async (req: Request, res: Response) => {
  const items = z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int().min(0) })).parse(req.body)
  const events = await service.reorderEvents(items)
  await invalidateTags(['events', 'event-sidebar'])
  res.json(successResponse(events, 'Events reordered successfully.'))
})

export const deleteEvent = asyncHandler(async (req: Request, res: Response) => {
  const existing = await service.getAdminEvent(req.params.id)
  if (!existing) throw new NotFoundError('Event not found.')
  await service.softDeleteEvent(req.params.id)
  await Promise.all([cleanupAssetIfUnused(existing.logo), cleanupAssetIfUnused(existing.banner)])
  await invalidateTags(['events', 'event-sidebar', `event:${req.params.id}`])
  emitAdminResourceDeleted('Event', req.params.id)
  res.json(successResponse({ id: req.params.id }, 'Event deleted successfully.'))
})
