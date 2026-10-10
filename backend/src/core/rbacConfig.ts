/**
 * The seeded role/permission matrix.
 *
 * Kept free of database imports so the effective permission set of every system role can be
 * asserted in unit tests without opening a connection.
 */

export const defaultRoles = [
  { name: 'super_admin', description: 'Platform administrator', isSystem: true },
  { name: 'admin', description: 'Business administrator', isSystem: true },
  { name: 'moderator', description: 'Project and content moderator', isSystem: true },
  { name: 'premium_user', description: 'Authenticated subscriber', isSystem: true },
  { name: 'user', description: 'Standard authenticated user', isSystem: true },
  { name: 'guest', description: 'Guest user', isSystem: true },
] as const

export const defaultPermissions = [
  { key: 'admin.dashboard.view', description: 'View the admin dashboard' },
  { key: 'admin.users.manage', description: 'Manage platform users' },
  { key: 'admin.matches.manage', description: 'Manage match content' },
  { key: 'admin.settings.manage', description: 'Manage platform settings' },
  { key: 'admin.payments.view', description: 'View payment transactions' },
  // Project-management capabilities. Kept separate from the broader admin permissions so a
  // moderator never inherits user, billing or platform-settings authority.
  { key: 'admin.streams.manage', description: 'Manage match streams' },
  { key: 'admin.channels.manage', description: 'Manage channels and categories' },
  { key: 'admin.events.manage', description: 'Manage events' },
  { key: 'admin.highlights.manage', description: 'Manage highlights' },
  { key: 'admin.banners.manage', description: 'Manage site banners' },
  { key: 'admin.teams.view', description: 'Search teams and fixtures' },
  { key: 'admin.media.manage', description: 'Upload and manage media assets' },
  // Engagement/notification content. Deliberately excluded from the moderator permission set.
  { key: 'admin.content.manage', description: 'Manage advertisements, popups and email templates' },
  { key: 'moderator.dashboard.view', description: 'View the moderator dashboard' },
  { key: 'content.live.watch', description: 'Watch premium live content' },
  { key: 'content.highlights.view', description: 'View highlights' },
] as const

export type RoleName = (typeof defaultRoles)[number]['name']
export type PermissionKey = (typeof defaultPermissions)[number]['key']

/**
 * Permissions a moderator may hold. This is the allow-list the role is seeded from; anything not
 * named here (user administration, settings, payments, engagement content, the admin dashboard)
 * stays out of the moderator's reach.
 */
export const MODERATOR_PERMISSIONS: PermissionKey[] = [
  'moderator.dashboard.view',
  'admin.matches.manage',
  'admin.streams.manage',
  'admin.channels.manage',
  'admin.events.manage',
  'admin.highlights.manage',
  'admin.banners.manage',
  'admin.teams.view',
  'admin.media.manage',
]

/** Permissions an administrator holds, expressed as the pre-existing set plus everything split out of it. */
const ADMIN_PERMISSIONS: PermissionKey[] = [
  'admin.dashboard.view',
  'admin.users.manage',
  'admin.matches.manage',
  'admin.settings.manage',
  'admin.payments.view',
  'admin.streams.manage',
  'admin.channels.manage',
  'admin.events.manage',
  'admin.highlights.manage',
  'admin.banners.manage',
  'admin.teams.view',
  'admin.media.manage',
  'admin.content.manage',
  'content.highlights.view',
]

/**
 * The effective permission matrix for the seeded system roles.
 *
 * Admin and super admin keep every permission they had before, plus the permissions split out of
 * `admin.matches.manage`, so their existing access to advertisements, popups and email templates is
 * unchanged. A moderator receives the project-management surface and nothing else.
 */
export const rolePermissions: Record<RoleName, PermissionKey[]> = {
  super_admin: [...ADMIN_PERMISSIONS, 'content.live.watch'],
  admin: ADMIN_PERMISSIONS,
  moderator: MODERATOR_PERMISSIONS,
  premium_user: ['content.live.watch', 'content.highlights.view'],
  user: ['content.highlights.view'],
  guest: [],
}
