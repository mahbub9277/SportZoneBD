import { prisma } from '../../core/prisma.js'

export const findActiveBanners = () => prisma.banner.findMany({
  where: { isActive: true, deletedAt: null },
  orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
  select: { id: true, title: true, subtitle: true, type: true, imageUrl: true, videoUrl: true, posterUrl: true, badge: true, ctaText: true, ctaUrl: true, displayOrder: true },
})

export const findAllBanners = () => prisma.banner.findMany({ where: { deletedAt: null }, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }] })
export const findBanner = (id: string) => prisma.banner.findFirst({ where: { id, deletedAt: null } })
export const createBanner = (data: any) => prisma.banner.create({ data })
export const updateBanner = (id: string, data: any) => prisma.banner.update({ where: { id }, data })
export const softDeleteBanner = (id: string) => prisma.banner.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } })
export const reorderBanners = async (items: Array<{ id: string; displayOrder: number }>) => prisma.$transaction(items.map((item) => prisma.banner.update({ where: { id: item.id }, data: { displayOrder: item.displayOrder } })))