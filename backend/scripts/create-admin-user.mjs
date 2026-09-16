import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL

if (!connectionString) {
  throw new Error('DATABASE_URL or DIRECT_URL is required')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})
const email = process.env.SUPER_ADMIN_EMAIL
const password = process.env.SUPER_ADMIN_PASSWORD

try {
  const role = await prisma.role.upsert({
    where: { name: 'super_admin' },
    update: {},
    create: {
      name: 'super_admin',
      description: 'Has all permissions across the system.',
      isSystem: true,
    },
  })

  const hashedPassword = await bcrypt.hash(password, 10)

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash: hashedPassword,
      isActive: true,
      fullName: 'Super Admin',
      guestMode: false,
    },
    create: {
      email,
      fullName: 'Super Admin',
      passwordHash: hashedPassword,
      isActive: true,
      guestMode: false,
    },
    include: { roles: true },
  })

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: role.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: role.id,
    },
  })

  console.log(JSON.stringify({ email, role: role.name, userId: user.id }, null, 2))
} finally {
  await prisma.$disconnect()
}
