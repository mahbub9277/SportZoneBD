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
  subModules?: { label: string; path: string; icon: keyof typeof icons }[]
}

/**
 * The project-management modules a moderator or an administrator-made custom role may be given.
 *
 * Every module names the permission it needs, so navigation is filtered from the permissions the
 * backend actually resolved for the signed-in user instead of from a role name.
 */
export const CONSOLE_MODULES: ConsoleModule[] = [
  {
    label: 'Matches',
    path: 'matches',
    icon: 'Swords',
    permission: 'admin.matches.manage',
    subModules: [
      { label: 'Create Match', path: 'matches', icon: 'CirclePlus' },
      { label: 'Live Matches', path: 'live-matches', icon: 'Clapperboard' },
      { label: 'Upcoming Matches', path: 'upcoming-matches', icon: 'Video' },
      { label: 'Finished Matches', path: 'finished-matches', icon: 'FileClock' },
    ],
  },
  { label: 'Streams', path: 'streams', icon: 'Radio', permission: 'admin.streams.manage' },
  { label: 'Highlights', path: 'highlights', icon: 'Film', permission: 'admin.highlights.manage' },
  { label: 'Channels', path: 'channels', icon: 'Tv', permission: 'admin.channels.manage' },
  { label: 'Events', path: 'events', icon: 'LayoutList', permission: 'admin.events.manage' },
  { label: 'Banner Manager', path: 'banner-manager', icon: 'Palette', permission: 'admin.banners.manage' },
]

/** The modules the given permissions unlock, in catalogue order. */
export function selectConsoleModules(permissions: readonly string[]): ConsoleModule[] {
  const granted = new Set(permissions)
  return CONSOLE_MODULES.filter((module) => granted.has(module.permission))
}

/**
 * Builds the sidebar for a console: always-available Dashboard and Profile, then the permitted
 * modules. Sections with nothing left to show are dropped rather than rendered empty.
 */
export function buildConsoleNav(base: string, permissions: readonly string[]): ConsoleNavSection[] {
  const links: ConsoleNavLink[] = selectConsoleModules(permissions).map((module) => ({
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
    { title: 'Content', links },
  ]

  return sections.filter((section) => section.links.length > 0)
}
