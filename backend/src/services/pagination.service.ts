import { prisma } from '../core/prisma.js';
import type { Prisma } from '@prisma/client';
import type { PaginationMeta } from '../core/api-response.js'

export interface PaginatedQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  where?: Prisma.MatchWhereInput | Prisma.UserWhereInput | Prisma.StreamWhereInput | Prisma.HighlightWhereInput; // More generic where
  [key: string]: any;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: PaginationMeta;
}

interface GetPaginatedDataOptions<T> {
  model: keyof typeof prisma;
  query: PaginatedQuery;
  searchableFields?: string[];
  include?: any;
  select?: any;
}

/**
 * A generic service for fetching paginated data from a Prisma model.
 *
 * @param {GetPaginatedDataOptions} options - The options for pagination.
 * @param {keyof typeof prisma} options.model - The name of the Prisma model (e.g., 'user').
 * @param {PaginatedQuery} options.query - The pagination and filter query.
 * @param {string[]} [options.searchableFields] - Fields to search against.
 * @param {object} [options.include] - Prisma include object.
 * @param {object} [options.select] - Prisma select object.
 * @returns A promise that resolves to the paginated data and metadata.
 */
export async function getPaginatedData<T>(
  options: GetPaginatedDataOptions<T>,
): Promise<PaginatedResult<T>> {
  const { model, query, searchableFields = [], include, select } = options;
  const requestedPage = Number(query.page ?? 1)
  const requestedLimit = Number(query.limit ?? 10)
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 10
  const { search, where: queryWhere } = query;

  const sortValue = (query.sort as string | undefined) ?? (query.sortBy as string | undefined) ?? 'createdAt:desc';
  const normalizedSortValue = sortValue.trim();
  const [sortFieldRaw, sortOrderRaw] = normalizedSortValue.split(':');
  const sortField = sortFieldRaw?.trim();
  const sortOrder = sortOrderRaw?.trim().toLowerCase();

  const validSortFields = new Set([
    'id',
    'title',
    'status',
    'premium',
    'kickoffAt',
    'createdAt',
    'updatedAt',
    'startTime',
    'endTime',
    'name',
    'email',
    'username',
  ])

  const orderBy = validSortFields.has(sortField) && ['asc', 'desc'].includes(sortOrder)
    ? { [sortField]: sortOrder }
    : { createdAt: 'desc' }

  const skip = (page - 1) * limit;

  const whereClause: any = { ...queryWhere };

  if (search && searchableFields.length > 0) {
    whereClause.OR = searchableFields.map((field: string) => ({
      [field]: { contains: search, mode: 'insensitive' },
    }));
  }

  // Keep these independent reads pooler-friendly; interactive transactions
  // are not reliable through Supabase transaction-mode pooling.
  const dbModel = (prisma as any)[model]
  const [items, totalItems] = await Promise.all([
    dbModel.findMany({ where: whereClause, take: limit, skip, orderBy, include, select }),
    dbModel.count({ where: whereClause }),
  ])
  const totalPages = Math.ceil(totalItems / limit);

  return {
    items,
    meta: {
      totalItems,
      itemCount: items.length,
      itemsPerPage: limit,
      totalPages,
      currentPage: page,
    },
  };
}