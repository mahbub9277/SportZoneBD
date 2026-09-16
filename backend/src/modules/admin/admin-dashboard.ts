import { prisma } from '../../core/prisma.js'

export async function getAdminDashboardData() {
  const [users, premiumUsers, guests, activeMatches, pendingPayments] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    prisma.user.count({ where: { guestMode: true, deletedAt: null } }),
    prisma.match.count({ where: { status: 'LIVE', deletedAt: null } }),
    prisma.payment.count({ where: { status: 'PENDING', deletedAt: null } }),
  ])

  return {
    totalUsers: users,
    premiumUsers,
    guestUsers: guests,
    activeMatches,
    pendingPayments,
  }
}
