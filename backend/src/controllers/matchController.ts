import { prisma } from '../core/prisma.js';
import { NotFoundError, AppError } from '../core/errors.js';
import asyncHandler from '../utils/asyncHandler.js';
import { cleanupMatch } from '../services/match-cleanup.service.js';
import { z } from 'zod';
import { getPaginatedData } from '../services/pagination.service.js';
import { successResponse } from '../core/api-response.js';
import { hasPremiumAccess } from '../core/premiumGuard.js';
import type { Prisma } from '@prisma/client'

const getAllMatchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
  premium: z.preprocess((value) => {
    if (typeof value === 'boolean') return value
    if (typeof value !== 'string') return undefined
    return value.toLowerCase() === 'true' ? true : value.toLowerCase() === 'false' ? false : value
  }, z.boolean().optional()),
  activeOnly: z.preprocess((value) => value === 'true' || value === true, z.boolean().default(false)),
  sort: z.string().optional(),
  status: z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const normalized = value.toUpperCase()
    return normalized === 'ALL' ? undefined : normalized
  }, z.enum(['UPCOMING', 'LIVE', 'FINISHED']).optional()),
  sortBy: z.string().regex(/^[a-zA-Z_]+:(asc|desc)$/).optional(),
});

/**
 * @desc    Get all matches with pagination, filtering, and sorting
 * @route   GET /api/v1/matches
 * @access  Public
 */
export const getAllMatches = asyncHandler(async (req, res) => {
  const parsedQuery = getAllMatchesQuerySchema.parse(req.query);
  const { status, premium, activeOnly, sort, ...paginationQuery } = parsedQuery
  let sortBy = parsedQuery.sortBy
  if (!sortBy && sort) {
    const [field, order] = sort.includes(':') ? sort.split(':') : sort.split('-')
    const sortableFields = new Set(['date', 'kickoffAt', 'title', 'createdAt'])
    const normalizedOrder = order === 'desc' ? 'desc' : 'asc'
    if (sortableFields.has(field)) {
      sortBy = `${field === 'date' ? 'kickoffAt' : field}:${normalizedOrder}`
    }
  }
  sortBy ??= 'createdAt:desc'
  const where: Prisma.MatchWhereInput = {
    ...(status ? { status } : activeOnly ? { status: { in: ['LIVE', 'UPCOMING'] as ('LIVE' | 'UPCOMING')[] } } : {}),
    ...(premium !== undefined ? { premium } : {}),
  }
  const { items, meta } = await getPaginatedData({
    model: 'match',
    query: { ...paginationQuery, sortBy },
    where,
    searchableFields: ['title', 'tournamentName', 'homeTeamName', 'awayTeamName'],
    include: {
      streams: {
        where: { enabled: true, deletedAt: null, status: { notIn: ['OFFLINE', 'ERROR'] } },
        orderBy: { createdAt: 'asc' },
        include: {
          channel: {
            select: { id: true, name: true, url: true, logo: true },
          },
        },
      },
      homeTeam: true,
      awayTeam: true,
    },
  });
  res.status(200).json(successResponse({ items, meta }, 'Matches retrieved successfully'));
});

/**
 * @desc    Get a single match by ID
 * @route   GET /api/v1/matches/:id
 * @access  Public
 */
export const getMatchById = asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  // Use the Prisma client to find a unique match by its ID
  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      streams: {
        where: {
          enabled: true,
          deletedAt: null,
          status: { notIn: ['OFFLINE', 'ERROR'] },
        },
        include: {
          channel: {
            select: { id: true, name: true, url: true, logo: true },
          },
        },
      },
      homeTeam: true,
      awayTeam: true,
      highlights: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!match) {
    // This error will be caught by your central errorHandler
    throw new NotFoundError(`Match not found with id of ${id}`);
  }

  const canAccessPremium = match.premium ? await hasPremiumAccess(req, res) : true;
  const safeMatch = canAccessPremium || !match.premium
    ? match
    : { ...match, streams: [] };

  res.status(200).json(successResponse(safeMatch, 'Match retrieved successfully'));
});

/**
 * @desc    Create a new match
 * @route   POST /api/v1/matches
 * @access  Private (Admin)
 */
export const createMatch = asyncHandler(async (req, res) => {
  const payload = req.body; // Assuming body is pre-validated by a middleware
  const match = await prisma.match.create({
    data: {
      ...payload,
      kickoffAt: new Date(payload.kickoffAt),
    },
  });
  res.status(201).json(successResponse(match, 'Match created successfully'));
});

/**
 * @desc    Update a match
 * @route   PATCH /api/v1/matches/:id
 * @access  Private (Admin)
 */
export const updateMatch = asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  try {
    const updatedMatch = await prisma.$transaction(async (tx) => {
      const payload = req.body;

      // Convert kickoffAt to Date object if it exists in the payload
      if (payload.kickoffAt) {
        payload.kickoffAt = new Date(payload.kickoffAt);
      }


      return tx.match.update({
        where: { id },
        data: payload,
      });
    });
    res.status(200).json(successResponse(updatedMatch, 'Match updated successfully'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') { // Prisma's error code for "Record to update not found."
      throw new NotFoundError(`Match not found with id of ${id}`);
    }
    throw error; // Re-throw other errors to be handled by the central errorHandler
  }
});

/**
 * @desc    Delete a match
 * @route   DELETE /api/v1/matches/:id
 * @access  Private (Admin)
 */
export const deleteMatch = asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const result = await cleanupMatch(id, 'ADMIN_DELETE');
  if (!result.deleted) throw new NotFoundError(`Match not found with id of ${id}`);
  res.status(200).json(successResponse({ id }, 'Match and associated records deleted successfully'));
});

/**
 * @desc    Soft delete a match
 * @route   DELETE /api/v1/matches/:id
 * @access  Private (Admin)
 */
export const softDeleteMatch = asyncHandler(async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  try {
    const softDeletedMatch = await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({ where: { id } });

      if (!match) {
        throw new NotFoundError(`Match not found with id of ${id}`);
      }

      return tx.match.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
    res.status(200).json(successResponse({ id: softDeletedMatch.id }, 'Match soft-deleted and images removed successfully'));
  } catch (error) {
    throw error; // Let the asyncHandler and global error handler manage it
  }
});