import { prisma } from '../../core/prisma.js';
import type { Prisma } from '@prisma/client'

export const findAllMatches = (options: Prisma.MatchFindManyArgs = {}) => {
  // Add options for filtering, pagination, etc. later
  return prisma.match.findMany(options);
};

export const findMatchById = (id: string) => {
  return prisma.match.findUnique({
    where: { id },
    // include related models if necessary
    // include: { streams: true }
  });
};