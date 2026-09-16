import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL

if (!connectionString) {
  throw new Error('DATABASE_URL or DIRECT_URL is required')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})

const statements = [
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verificationOtp" TEXT',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verificationOtpExpires" TIMESTAMP(3)',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordResetToken" TEXT',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordResetExpires" TIMESTAMP(3)',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "guestMode" BOOLEAN NOT NULL DEFAULT TRUE',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isBanned" BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3)',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3)',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)'
]

try {
  for (const sql of statements) {
    await prisma.$executeRawUnsafe(sql)
  }
  console.log('User columns synced successfully')
} finally {
  await prisma.$disconnect()
}
