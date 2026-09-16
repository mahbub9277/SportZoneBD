import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector } from '../../app/hooks';
import { selectCurrentUser, selectIsAuthenticated, selectIsInitializing } from '../../features/auth/auth.slice';

interface ProtectedRouteProps {
  allowedRoles?: string[];
  requiredPermissions?: string[]; // New prop for granular permissions
  loginPath?: string;
  unauthorizedPath?: string;
}

export function ProtectedRoute({
  allowedRoles,
  requiredPermissions,
  loginPath = '/login',
  unauthorizedPath = '/unauthorized',
}: ProtectedRouteProps) {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const user = useAppSelector(selectCurrentUser);
  const isInitializing = useAppSelector(selectIsInitializing);
  const location = useLocation();

  if (isInitializing) {
    return null;
  }

  // 1. Check Authentication
  if (!isAuthenticated || !user) {
    // Redirect them to the login page, but save the current location they were
    // trying to go to. This allows us to send them along to that page after they login.
    return <Navigate to={loginPath} state={{ from: location }} replace />;
  }

  // 2. Check Roles (if allowedRoles are specified)
  if (allowedRoles && allowedRoles.length > 0) {
    // The user object from the API should have a consistent shape.
    // Let's assume `user.roles` is an array of strings like ['admin', 'premium_user'].
    const userRoles = user.roles?.map(r => r.role?.name || r.name).filter(Boolean) ?? [];
    const normalizedRoles = userRoles.map(roleName => roleName.toUpperCase());

    const hasRequiredRole = allowedRoles.some((role) => normalizedRoles.includes(role.toUpperCase()));
    if (!hasRequiredRole) {
      return <Navigate to={unauthorizedPath} state={{ from: location }} replace />;
    }
  }

  // 3. Check Permissions (if requiredPermissions are specified)
  if (requiredPermissions && requiredPermissions.length > 0) {
    const userPermissions = user.permissions ?? [];
    const hasRequiredPermissions = requiredPermissions.every(permission => userPermissions.includes(permission));
    if (!hasRequiredPermissions) {
      return <Navigate to={unauthorizedPath} state={{ from: location }} replace />;
    }
  }

  // If authenticated and authorized, render the child routes
  return <Outlet />;
}