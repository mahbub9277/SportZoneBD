import type { Request, Response } from 'express'
import crypto from 'crypto'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js'
import { successResponse, errorResponse } from '../../core/api-response.js'
import { emailTemplateSchema } from './email.templates.validator.js'
import { invalidateTags } from '../../core/cache.js'
import { emitAdminResourceCreated, emitAdminResourceUpdated, emitAdminResourceDeleted } from '../../core/socketManager.js'
import { Prisma } from '@prisma/client'
import { recordModerationEvent } from '../../core/moderationAudit.js'
import {
  EMAIL_CAMPAIGN_MAX_RECIPIENTS,
  countEmailAudience,
  isEmailAudience,
  sendEmailCampaign,
} from '../../services/emailCampaign.service.js'

const getEmailTemplates = asyncHandler(async (_req: Request, res: Response) => {
  const templates = await prisma.emailTemplate.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  res.status(200).json(successResponse(templates, 'Email templates retrieved.'))
})

/**
 * The enabled templates a campaign may be started from.
 *
 * Read-only and intentionally narrow: a sender needs the subject, the body and the audience to preview
 * what will go out, and nothing about how the template is administered.
 */
const getSendableEmailTemplates = asyncHandler(async (_req: Request, res: Response) => {
  const templates = await prisma.emailTemplate.findMany({
    where: { deletedAt: null, enabled: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, subject: true, body: true, targetAudience: true, link: true, enabled: true, updatedAt: true },
  })
  res.status(200).json(successResponse(templates, 'Sendable email templates retrieved.'))
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

/**
 * Starts an email campaign from an enabled template.
 *
 * The template decides the audience and the wording, the campaign service decides the limit and the
 * batching, and the provider decides success: the response reports the messages it accepted and refused,
 * the recipients that were skipped once the campaign limit was reached, and a few real failure reasons.
 * The send is recorded in the audit trail with the authenticated sender, so an accidental campaign has an
 * owner and a time.
 */
const sendEmailTemplate = asyncHandler(async (req: Request, res: Response) => {
  const template = await prisma.emailTemplate.findFirst({ where: { id: req.params.id, deletedAt: null, enabled: true } })
  if (!template) return res.status(404).json(errorResponse('Enabled email template not found.'))

  const audience = isEmailAudience(template.targetAudience) ? template.targetAudience : 'ALL'
  const result = await sendEmailCampaign({
    subject: template.subject,
    body: template.body,
    link: template.link,
    audience,
  })

  const actorId = (req as Request & { user?: { id?: string; fullName?: string | null } }).user?.id
  const campaignId = crypto.randomUUID()

  if (actorId) {
    await recordModerationEvent({
      action: 'email.campaign.sent',
      actorId,
      actorName: (req as Request & { user?: { fullName?: string | null } }).user?.fullName ?? null,
      entityId: campaignId,
      outcome: result.sentCount > 0 ? 'success' : 'failure',
      requestId: (req as Request & { id?: string }).id ?? null,
      details: {
        templateId: template.id,
        subject: template.subject,
        audience,
        totalRecipients: result.totalRecipients,
        attempted: result.attempted,
        sentCount: result.sentCount,
        failedCount: result.failedCount,
        skippedCount: result.skippedCount,
        truncated: result.truncated,
      },
    })
  }

  res.status(200).json(successResponse({ campaignId, ...result }, 'Email campaign finished.'))
})

/**
 * The audience sizes a sender confirms against before starting a campaign.
 *
 * Counted from the same audience rule the send resolves, so the confirmation shows real numbers.
 */
const getEmailCampaignAudiences = asyncHandler(async (_req: Request, res: Response) => {
  const [all, premium, free] = await Promise.all([
    countEmailAudience('ALL'),
    countEmailAudience('PREMIUM'),
    countEmailAudience('FREE'),
  ])

  res.status(200).json(successResponse({
    maxRecipients: EMAIL_CAMPAIGN_MAX_RECIPIENTS,
    audiences: [
      { audience: 'ALL', recipients: all },
      { audience: 'PREMIUM', recipients: premium },
      { audience: 'FREE', recipients: free },
    ],
  }, 'Email campaign audiences retrieved.'))
})

export const emailTemplatesController = {
  getEmailTemplates,
  getSendableEmailTemplates,
  getEmailCampaignAudiences,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  sendEmailTemplate,
}