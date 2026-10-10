import { Router } from 'express'
import { emailTemplatesController } from './email.templates.controller.js'
import { validateBody } from '../../core/validation.js'
import { emailTemplateSchema } from './email.templates.validator.js'

const emailTemplatesRouter = Router()

// Template administration. Sending is registered separately by the admin router, because starting a
// campaign is a moderation operation with its own permission rather than part of editing templates.
emailTemplatesRouter.get('/', emailTemplatesController.getEmailTemplates)
emailTemplatesRouter.post('/', validateBody(emailTemplateSchema), emailTemplatesController.createEmailTemplate)
emailTemplatesRouter.patch('/:id', validateBody(emailTemplateSchema.partial()), emailTemplatesController.updateEmailTemplate)
emailTemplatesRouter.delete('/:id', emailTemplatesController.deleteEmailTemplate)

export default emailTemplatesRouter