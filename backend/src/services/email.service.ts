import nodemailer, { Transporter } from 'nodemailer'
import logger from '../core/logger.js'
import { getForgotPasswordTemplate, getRegistrationOtpTemplate, getWelcomeEmailTemplate } from './email.templates.js'

interface MailOptions {
  to: string
  subject: string
  text: string
  html: string
}

const smtpHost = process.env.SMTP_HOST
const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465
const smtpSecure = process.env.SMTP_SECURE === 'true'
const smtpUser = process.env.SMTP_USER
const smtpPass = process.env.SMTP_PASS
const smtpFrom = process.env.SMTP_FROM ?? '"Sport Zone BD" <no-reply@sportzonebd.com>'

const transporter: Transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: { user: smtpUser, pass: smtpPass },
  tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
})

async function verifyTransporter(): Promise<void> {
  try {
    await transporter.verify()
    logger.info({ smtpHost, smtpPort, smtpFrom }, 'SMTP transporter verified')
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : error, smtpHost, smtpPort }, 'SMTP transporter verification failed')
  }
}

void verifyTransporter()

export async function sendEmail(options: MailOptions) {
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    throw new Error('SMTP configuration is incomplete')
  }

  try {
    const info = await transporter.sendMail({
      from: smtpFrom,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    })
    logger.info({ messageId: info.messageId, to: options.to }, 'Email sent')
    return info
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : error, to: options.to }, 'Failed to send mail')
    throw error
  }
}

export async function sendVerificationOTPEmail(toEmail: string, otpCode: string) {
  if (!/^\d{6}$/.test(otpCode)) {
    throw new Error('Verification OTP must be exactly 6 digits')
  }
  const subject = 'Your Sport Zone BD verification code'
  const text = `Your Sport Zone BD verification code is ${otpCode}. It expires in 10 minutes.`

  return sendEmail({
    to: toEmail,
    subject,
    text,
    html: getRegistrationOtpTemplate(otpCode),
  })
}

export async function sendPasswordResetOTPEmail(toEmail: string, otpCode: string) {
  if (!/^\d{6}$/.test(otpCode)) {
    throw new Error('Password reset OTP must be exactly 6 digits')
  }
  const subject = 'Your SportZoneBD Password Reset Code'
  const text = `Your SportZoneBD password reset code is ${otpCode}. It expires in 10 minutes.`

  return sendEmail({
    to: toEmail,
    subject,
    text,
    html: getForgotPasswordTemplate(otpCode),
  })
}

export async function sendWelcomeEmail(user: { email: string | null; fullName: string | null }) {
  if (!user.email) return

  return sendEmail({
    to: user.email,
    subject: 'Welcome to SportZoneBD',
    text: `Congratulations ${user.fullName || 'there'}! Your SportZoneBD account is ready.`,
    html: getWelcomeEmailTemplate(user.fullName || 'there'),
  })
}
