interface RolePermission {
  key: string;
}

interface Role {
  id: string;
  name: string;
  description?: string;
  /** Present when the API flattens a role; the profile nests these fields under `role`. */
  isSystem?: boolean;
  /** Permission keys granted by this role, as resolved by the backend. */
  permissions?: RolePermission[];
  role?: {
    id?: string;
    name: string;
    isSystem?: boolean;
    permissions?: RolePermission[];
  };
}

interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  durationDays: number;
  description?: string;
}

interface Subscription {
  id: string;
  status: 'ACTIVE' | 'INACTIVE' | 'CANCELED' | 'EXPIRED';
  startedAt: string;
  expiresAt: string;
  plan: SubscriptionPlan;
}

export interface User {
  id: string;
  email: string | null;
  fullName: string | null;
  avatar: string | null;
  createdAt: string;
  isActive: boolean;
  roles: Role[];
  subscription?: Subscription | null;
  isSuspended?: boolean;
  deletedAt?: string | null;
  permissions?: string[];
}

export interface PaginationMeta {
  totalItems: number;
  itemCount: number;
  itemsPerPage: number;
  totalPages: number;
  currentPage: number;
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  user: User;
}

/**
 * The refresh response only carries the profile when the client explicitly asks for it (the startup
 * bootstrap), so the silent 401-driven refreshes keep returning no body.
 */
export type RefreshResponse = {
  user?: User;
}