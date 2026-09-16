import prisma from '../core/prisma.js'
import logger from '../core/logger.js'
import { ensureDefaultRBAC } from '../core/rbac.js'

async function main() {
  logger.info('Seeding process started...')

  // Seed Roles, Permissions, and Admin Users
  await ensureDefaultRBAC()
}

main()
  .catch((e) => {
    logger.error(e, 'An error occurred during the seeding process.')
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    logger.info('Prisma client disconnected.')
  })