interface Role {
  id: string;
  name: string;
  description?: string;
  role?: {
    name: string;
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
  [x: string]: unknown;
  user: User;
  accessToken?: string; // Only present in refresh responses now
}