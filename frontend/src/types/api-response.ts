export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: unknown;
  meta?: PaginationMeta;
}

export interface PaginatedApiResponse<T> {
  items: T[];
  meta: PaginationMeta;
}