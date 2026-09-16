import { prisma } from '../../core/prisma.js';

export const findAllMatches = (options = {}) => {
  // Add options for filtering, pagination, etc. later
  return prisma.match.findMany(options);
};

export const findMatchById = (id) => {
  return prisma.match.findUnique({
    where: { id },
    // include related models if necessary
    // include: { streams: true }
  });
};