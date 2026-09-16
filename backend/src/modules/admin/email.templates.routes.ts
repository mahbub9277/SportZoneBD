import { Router } from 'express'
import { emailTemplatesController } from './email.templates.controller.js'
import { validateBody } from '../../core/validation.js'
import { emailTemplateSchema } from './email.templates.validator.js'

const emailTemplatesRouter = Router()

emailTemplatesRouter.get('/', emailTemplatesController.getEmailTemplates)
emailTemplatesRouter.post('/', validateBody(emailTemplateSchema), emailTemplatesController.createEmailTemplate)
emailTemplatesRouter.patch('/:id', validateBody(emailTemplateSchema.partial()), emailTemplatesController.updateEmailTemplate)
emailTemplatesRouter.delete('/:id', emailTemplatesController.deleteEmailTemplate)
emailTemplatesRouter.post('/:id/send', emailTemplatesController.sendEmailTemplate)

export default emailTemplatesRouter