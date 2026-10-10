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
  // Moderation operations. Each one is a single capability rather than a slice of the admin console:
  // reviewing reports, deciding manual payments, reading premium records, sending campaigns, and
  // reading the moderation audit trail.
  { key: 'admin.reports.manage', description: 'Review and resolve user reports' },
  { key: 'admin.payments.review', description: 'Decide manual payment submissions' },
  { key: 'admin.premium.view', description: 'View premium members and subscription records' },
  { key: 'admin.push.send', description: 'Send push notification campaigns' },
  { key: 'admin.email.send', description: 'Send email notification campaigns' },
  { key: 'admin.activity.view', description: 'View moderation activity and audit history' },
  { key: 'moderator.dashboard.view', description: 'View the moderator dashboard' },
  { key: 'content.live.watch', description: 'Watch premium live content' },
  { key: 'content.highlights.view', description: 'View highlights' },
] as const

export type RoleName = (typeof defaultRoles)[number]['name']
export type PermissionKey = (typeof defaultPermissions)[number]['key']

/**
 * Capabilities that describe the moderation operations a moderator runs.
 *
 * They are named separately because the moderator set and the admin set are both built from them: the
 * two roles hold the same moderation capabilities, while everything else an administrator has stays
 * out of the moderator's reach.
 */
const MODERATION_OPERATION_PERMISSIONS: PermissionKey[] = [
  'admin.reports.manage',
  'admin.payments.view',
  'admin.payments.review',
  'admin.premium.view',
  'admin.push.send',
  'admin.email.send',
  'admin.activity.view',
]

/**
 * Permissions a moderator may hold. This is the allow-list the role is seeded from: the project
 * management surface plus the moderation operations above. Anything not named here (user
 * administration, platform settings, engagement content, the admin dashboard, premium playback) stays
 * out of the moderator's reach, and nothing here can create or edit a payment, plan price or role.
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
  ...MODERATION_OPERATION_PERMISSIONS,
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
  ...MODERATION_OPERATION_PERMISSIONS,
]

/**
 * The effective permission matrix for the seeded system roles.
 *
 * Admin and super admin keep every permission they had before, including the moderation operations,
 * so gating report review, manual payment decisions, premium records, campaigns and the audit trail by
 * permission changes nothing about what an administrator can reach. A moderator receives the
 * project-management surface plus those moderation operations and nothing else.
 */
export const rolePermissions: Record<RoleName, PermissionKey[]> = {
  super_admin: [...new Set<PermissionKey>([...ADMIN_PERMISSIONS, 'content.live.watch'])],
  admin: [...new Set(ADMIN_PERMISSIONS)],
  moderator: MODERATOR_PERMISSIONS,
  premium_user: ['content.live.watch', 'content.highlights.view'],
  user: ['content.highlights.view'],
  guest: [],
}
