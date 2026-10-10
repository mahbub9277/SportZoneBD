import type { icons } from 'lucide-react'

export interface ConsoleNavLink {
  label: string
  mobileLabel?: string
  href: string
  icon: keyof typeof icons
  end?: boolean
  /** Permission required to see and use this module. Links without one are always available. */
  permission?: string
  subLinks?: ConsoleNavLink[]
}

export interface ConsoleNavSection {
  title: string
  links: ConsoleNavLink[]
}

export interface ConsoleModule {
  label: string
  mobileLabel?: string
  /** Path within the console, e.g. `matches`. */
  path: string
  icon: keyof typeof icons
  end?: boolean
  /** Permission required to reach the module. */
  permission: string
  /** Which navigation section the module belongs to. */
  section: 'Content' | 'Moderation'
  subModules?: { label: string; path: string; icon: keyof typeof icons }[]
}

/**
 * The modules a moderator or an administrator-made custom role may be given.
 *
 * Every module names the permission it needs, so navigation is filtered from the permissions the backend
 * actually resolved for the signed-in user instead of from a role name. The moderation modules are the
 * operations a moderator runs rather than a slice of the admin console: reports, payment review, premium
 * records, campaigns and the audit trail.
 */
export const CONSOLE_MODULES: ConsoleModule[] = [
  {
    label: 'Reports',
    path: 'reports',
    icon: 'FileText',
    permission: 'admin.reports.manage',
    section: 'Moderation',
  },
  {
    label: 'Manual Review',
    mobileLabel: 'Review',
    path: 'payment-review',
    icon: 'Check',
    permission: 'admin.payments.review',
    section: 'Moderation',
  },
  {
    label: 'Payments',
    path: 'payments',
    icon: 'Receipt',
    permission: 'admin.payments.view',
    section: 'Moderation',
  },
  {
    label: 'Premium Members',
    mobileLabel: 'Premium',
    path: 'premium-members',
    icon: 'Star',
    permission: 'admin.premium.view',
    section: 'Moderation',
  },
  {
    label: 'Push Campaigns',
    mobileLabel: 'Push',
    path: 'push-campaigns',
    icon: 'BellRing',
    permission: 'admin.push.send',
    section: 'Moderation',
  },
  {
    label: 'Email Campaigns',
    mobileLabel: 'Email',
    path: 'email-campaigns',
    icon: 'Mail',
    permission: 'admin.email.send',
    section: 'Moderation',
  },
  {
    label: 'Activity',
    path: 'activity',
    icon: 'Activity',
    permission: 'admin.activity.view',
    section: 'Moderation',
  },
  {
    label: 'Matches',
    path: 'matches',
    icon: 'Swords',
    permission: 'admin.matches.manage',
    section: 'Content',
    subModules: [
      { label: 'Create Match', path: 'matches', icon: 'CirclePlus' },
      { label: 'Live Matches', path: 'live-matches', icon: 'Clapperboard' },
      { label: 'Upcoming Matches', path: 'upcoming-matches', icon: 'Video' },
      { label: 'Finished Matches', path: 'finished-matches', icon: 'FileClock' },
    ],
  },
  { label: 'Streams', path: 'streams', icon: 'Radio', permission: 'admin.streams.manage', section: 'Content' },
  { label: 'Highlights', path: 'highlights', icon: 'Film', permission: 'admin.highlights.manage', section: 'Content' },
  { label: 'Channels', path: 'channels', icon: 'Tv', permission: 'admin.channels.manage', section: 'Content' },
  { label: 'Events', path: 'events', icon: 'LayoutList', permission: 'admin.events.manage', section: 'Content' },
  { label: 'Banner Manager', path: 'banner-manager', icon: 'Palette', permission: 'admin.banners.manage', section: 'Content' },
]

/** The modules the given permissions unlock, in catalogue order. */
export function selectConsoleModules(permissions: readonly string[]): ConsoleModule[] {
  const granted = new Set(permissions)
  return CONSOLE_MODULES.filter((module) => granted.has(module.permission))
}

/**
 * Builds the sidebar for a console: always-available Dashboard and Profile, then the permitted modules
 * grouped by section. Sections with nothing left to show are dropped rather than rendered empty.
 */
export function buildConsoleNav(base: string, permissions: readonly string[]): ConsoleNavSection[] {
  const modules = selectConsoleModules(permissions)
  const linksFor = (section: ConsoleModule['section']): ConsoleNavLink[] =>
    modules
      .filter((module) => module.section === section)
      .map((module) => ({
        label: module.label,
        mobileLabel: module.mobileLabel,
        href: `${base}/${module.path}`,
        icon: module.icon,
        end: module.end,
        permission: module.permission,
        subLinks: module.subModules?.map((subModule) => ({
          label: subModule.label,
          href: `${base}/${subModule.path}`,
          icon: subModule.icon,
          end: subModule.path === module.path,
          permission: module.permission,
        })),
      }))

  const sections: ConsoleNavSection[] = [
    {
      title: 'General',
      links: [
        { label: 'Dashboard', href: base, icon: 'LayoutDashboard', end: true },
        { label: 'Profile', href: `${base}/profile`, icon: 'User' },
      ],
    },
    { title: 'Moderation', links: linksFor('Moderation') },
    { title: 'Content', links: linksFor('Content') },
  ]

  return sections.filter((section) => section.links.length > 0)
}
