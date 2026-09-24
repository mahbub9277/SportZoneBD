import * as matchRepository from './match.repository.js';
import { prisma } from '../../core/prisma.js';
import type { Prisma } from '@prisma/client'

export const getMatches = async () => {
  // Business logic for fetching matches can go here.
  // For example, filtering based on user subscription.
  return matchRepository.findAllMatches();
};
export const getMatchById = async (matchId: string) => {
  const match = await matchRepository.findMatchById(matchId);
  if (!match) {
    throw new Error('Match not found');
  }
  return match;
};

export const createMatch = async (data: Prisma.MatchCreateInput | Prisma.MatchUncheckedCreateInput) => {
  return prisma.match.create({ data });
};

export const updateMatch = async (id: string, data: Prisma.MatchUpdateInput | Prisma.MatchUncheckedUpdateInput) => {
  return prisma.match.update({ where: { id }, data });
};