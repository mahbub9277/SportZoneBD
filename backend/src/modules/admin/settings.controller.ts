import type { Request, Response } from 'express'
import crypto from 'node:crypto'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js'
import { successResponse } from '../../core/api-response.js'
import { invalidateTags } from '../../core/cache.js'
import { emitAdminResourceUpdated } from '../../core/socketManager.js'

const API_SETTINGS = {
  'api.base_url': {
    defaultValue: process.env.API_BASE_URL ?? '/api/v1',
    description: 'Base URL used by API clients.',
    validate: (value: string) => value.length > 0 && value.length <= 500,
  },
  'api.timeout_seconds': {
    defaultValue: '30',
    description: 'Maximum API request duration in seconds.',
    validate: (value: string) => /^([1-9]|[1-9][0-9]{1,3})$/.test(value),
  },
} as const

type ApiSettingKey = keyof typeof API_SETTINGS

const isApiSettingKey = (key: string): key is ApiSettingKey => key in API_SETTINGS

const ensureApiSettings = async () => {
  await prisma.$transaction(
    Object.entries(API_SETTINGS).map(([key, definition]) =>
      prisma.setting.upsert({
        where: { key },
        update: { deletedAt: null },
        create: {
          key,
          value: definition.defaultValue,
          type: 'string',
          description: definition.description,
        },
      }),
    ),
  )
}

const getSettings = asyncHandler(async (_req: Request, res: Response) => {
  await ensureApiSettings()
  const settings = await prisma.setting.findMany({
    where: { deletedAt: null },
    orderBy: { key: 'asc' },
  })
  res.status(200).json(successResponse(settings))
})

const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  if (!Array.isArray(req.body) || req.body.length === 0) {
    return res.status(400).json({ success: false, message: 'Settings must be a non-empty array.' })
  }

  const settingsToUpdate: { key: string; value: string; type?: string; description?: string }[] = req.body
  for (const setting of settingsToUpdate) {
    if (!setting || typeof setting.key !== 'string' || typeof setting.value !== 'string' || !setting.key.trim()) {
      return res.status(400).json({ success: false, message: 'Each setting requires a key and string value.' })
    }
    if (isApiSettingKey(setting.key) && !API_SETTINGS[setting.key].validate(setting.value)) {
      return res.status(400).json({ success: false, message: `Invalid value for ${setting.key}.` })
    }
  }

  const updatePromises = settingsToUpdate.map((setting) =>
    prisma.setting.upsert({
      where: { key: setting.key },
      update: {
        value: setting.value,
        ...(setting.type ? { type: setting.type } : {}),
        ...(setting.description !== undefined ? { description: setting.description } : {}),
        deletedAt: null,
      },
      create: {
        key: setting.key,
        value: setting.value,
        type: setting.type ?? 'string',
        description: setting.description ?? (isApiSettingKey(setting.key) ? API_SETTINGS[setting.key].description : null),
      },
    }),
  )

  const updatedSettings = await prisma.$transaction(updatePromises)
  
  await invalidateTags(['settings'])
  
  // Emit real-time event to admin clients
  emitAdminResourceUpdated('Settings', 'all', {
    count: updatedSettings.length
  })

  res.status(200).json(successResponse(updatedSettings, 'Settings updated successfully.'))
})

const PUSH_TEMPLATES_KEY = 'push.notification.templates'

const readPushTemplates = async () => {
  const setting = await prisma.setting.findUnique({ where: { key: PUSH_TEMPLATES_KEY } })
  if (!setting?.value) return []
  try {
    const templates = JSON.parse(setting.value)
    return Array.isArray(templates) ? templates : []
  } catch {
    return []
  }
}

const getPushNotificationTemplates = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json(successResponse(await readPushTemplates()))
})

const createPushNotificationTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { title, body, targetAudience, enabled, link } = req.body ?? {}
  if (typeof title !== 'string' || title.trim().length < 3 || typeof body !== 'string' || body.trim().length < 10 || typeof targetAudience !== 'string' || targetAudience.trim().length < 3 || typeof enabled !== 'boolean' || (link !== undefined && (typeof link !== 'string' || (!link.startsWith('/') && !/^https:\/\//i.test(link))))) {
    return res.status(400).json({ success: false, message: 'Invalid push notification template.' })
  }
  const templates = await readPushTemplates()
  const template = { id: crypto.randomUUID(), title: title.trim(), body: body.trim(), targetAudience: targetAudience.trim(), enabled, link: typeof link === 'string' ? link.trim() : '' }
  await prisma.setting.upsert({
    where: { key: PUSH_TEMPLATES_KEY },
    update: { value: JSON.stringify([...templates, template]), type: 'json' },
    create: { key: PUSH_TEMPLATES_KEY, value: JSON.stringify([template]), type: 'json' },
  })
  
  await invalidateTags(['settings'])
  
  // Emit real-time event to admin clients
  emitAdminResourceUpdated('Settings', 'push-templates', {
    id: template.id,
    title: template.title
  })
  
  res.status(201).json(successResponse(template, 'Push notification template created.'))
})

const updatePushNotificationTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { title, body, targetAudience, enabled, link } = req.body ?? {}
  if (typeof title !== 'string' || title.trim().length < 3 || typeof body !== 'string' || body.trim().length < 10 || typeof targetAudience !== 'string' || targetAudience.trim().length < 3 || typeof enabled !== 'boolean' || (link !== undefined && (typeof link !== 'string' || (!link.startsWith('/') && !/^https:\/\//i.test(link))))) {
    return res.status(400).json({ success: false, message: 'Invalid push notification template.' })
  }
  const templates = await readPushTemplates()
  const templateIndex = templates.findIndex((template: { id?: string }) => template.id === req.params.id)
  if (templateIndex < 0) return res.status(404).json({ success: false, message: 'Push notification template not found.' })
  const template = { ...templates[templateIndex], title: title.trim(), body: body.trim(), targetAudience: targetAudience.trim(), enabled, link: typeof link === 'string' ? link.trim() : '' }
  templates[templateIndex] = template
  await prisma.setting.upsert({
    where: { key: PUSH_TEMPLATES_KEY },
    update: { value: JSON.stringify(templates), type: 'json' },
    create: { key: PUSH_TEMPLATES_KEY, value: JSON.stringify(templates), type: 'json' },
  })
  await invalidateTags(['settings'])
  emitAdminResourceUpdated('Settings', 'push-templates', { id: template.id, title: template.title })
  res.status(200).json(successResponse(template, 'Push notification template updated successfully.'))
})

const deletePushNotificationTemplate = asyncHandler(async (req: Request, res: Response) => {
  const templates = await readPushTemplates()
  const nextTemplates = templates.filter((template: { id?: string }) => template.id !== req.params.id)
  if (nextTemplates.length === templates.length) return res.status(404).json({ success: false, message: 'Push notification template not found.' })
  await prisma.setting.upsert({
    where: { key: PUSH_TEMPLATES_KEY },
    update: { value: JSON.stringify(nextTemplates), type: 'json' },
    create: { key: PUSH_TEMPLATES_KEY, value: JSON.stringify(nextTemplates), type: 'json' },
  })
  
  await invalidateTags(['settings'])
  
  // Emit real-time event to admin clients
  emitAdminResourceUpdated('Settings', 'push-templates', {
    id: req.params.id
  })
  
  res.status(200).json(successResponse({ id: req.params.id }, 'Push notification template deleted successfully.'))
})

export const settingsController = { getSettings, updateSettings, getPushNotificationTemplates, createPushNotificationTemplate, updatePushNotificationTemplate, deletePushNotificationTemplate }