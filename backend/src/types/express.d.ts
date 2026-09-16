import type { User as PrismaUser } from '@prisma/client'

export interface AuthenticatedUser extends Omit<PrismaUser, 'passwordHash'> {
  id: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser
      file?: {
        filename: string
      }
    }
  }
}

export {}
