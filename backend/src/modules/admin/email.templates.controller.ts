import type { Request, Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js'
import { successResponse, errorResponse } from '../../core/api-response.js'
import { emailTemplateSchema } from './email.templates.validator.js'
import { invalidateTags } from '../../core/cache.js'
import { emitAdminResourceCreated, emitAdminResourceUpdated, emitAdminResourceDeleted } from '../../core/socketManager.js'
import { Prisma } from '@prisma/client'
import { sendEmail } from '../../services/email.service.js'
import { getEmailTemplate } from '../../services/email.templates.js'

const getEmailTemplates = asyncHandler(async (_req: Request, res: Response) => {
  const templates = await prisma.emailTemplate.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  res.status(200).json(successResponse(templates, 'Email templates retrieved.'))
})

const createEmailTemplate = asyncHandler(async (req: Request, res: Response) => {
  try {
    const validatedData = emailTemplateSchema.parse(req.body)
    const template = await prisma.emailTemplate.create({
      data: validatedData,
    })
    
    await invalidateTags(['email-templates'])
    
    // Emit real-time event to admin clients
    emitAdminResourceCreated('EmailTemplate', template.id, {
      id: template.id,
      subject: template.subject
    })
    
    res.status(201).json(successResponse(template, 'Email template created.'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return res.status(409).json(errorResponse('Email template with this key already exists'))
      }
    }
    throw error
  }
})

const updateEmailTemplate = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const validatedData = emailTemplateSchema.partial().parse(req.body)
    
    const template = await prisma.emailTemplate.update({
      where: { id },
      data: validatedData,
    })
    
    await invalidateTags(['email-templates'])
    
    // Emit real-time event to admin clients
    emitAdminResourceUpdated('EmailTemplate', id, {
      id: template.id,
      subject: template.subject
    })
    
    res.status(200).json(successResponse(template, 'Email template updated.'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json(errorResponse('Email template not found'))
      }
      if (error.code === 'P2002') {
        return res.status(409).json(errorResponse('Email template with this key already exists'))
      }
    }
    throw error
  }
})

const deleteEmailTemplate = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    await prisma.emailTemplate.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    
    await invalidateTags(['email-templates'])
    
    // Emit real-time event to admin clients
    emitAdminResourceDeleted('EmailTemplate', id)
    
    res.status(200).json(successResponse({ id }, 'Email template deleted.'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json(errorResponse('Email template not found'))
      }
    }
    throw error
  }
})

const sendEmailTemplate = asyncHandler(async (req: Request, res: Response) => {
  const template = await prisma.emailTemplate.findFirst({ where: { id: req.params.id, deletedAt: null, enabled: true } })
  if (!template) return res.status(404).json(errorResponse('Enabled email template not found.'))
  const targetAudience = template.targetAudience ?? 'ALL'

  const users = await prisma.user.findMany({
    where: {
      email: { not: null },
      isActive: true,
      isSuspended: false,
      isBanned: false,
      deletedAt: null,
      ...(targetAudience === 'PREMIUM'
        ? { subscriptions: { some: { status: 'ACTIVE', expiresAt: { gt: new Date() }, deletedAt: null } } }
        : targetAudience === 'FREE'
          ? { subscriptions: { none: { status: 'ACTIVE', expiresAt: { gt: new Date() }, deletedAt: null } } }
          : {}),
    },
    select: { email: true },
  })

  const results = await Promise.allSettled(users.flatMap((user) => user.email ? [sendEmail({
    to: user.email,
    subject: template.subject,
    text: template.body,
    html: getEmailTemplate({ title: template.subject, bodyText: template.body, link: template.link ?? undefined }),
  })] : []))
  const sentCount = results.filter((result) => result.status === 'fulfilled').length
  res.status(200).json(successResponse({ sentCount, failedCount: results.length - sentCount }, 'Email campaign completed.'))
})

export const emailTemplatesController = { getEmailTemplates, createEmailTemplate, updateEmailTemplate, deleteEmailTemplate, sendEmailTemplate }