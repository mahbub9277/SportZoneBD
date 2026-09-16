import type { icons } from 'lucide-react';

export interface NavLink {
  label: string;
  mobileLabel?: string;
  href: string;
  icon: keyof typeof icons;
  end?: boolean;
  subLinks?: NavLink[];
}

export interface NavSection {
  title: string;
  links: NavLink[];
}

export const navSections: NavSection[] = [
  {
    title: 'General',
    links: [
      { label: 'Dashboard', href: '/admin', icon: 'LayoutDashboard', end: true },
      { label: 'Analytics', href: '/admin/analytics', icon: 'ChartColumn' },
      { label: 'Profile', href: '/admin/profile', icon: 'User' },
    ],
  },
  {
    title: 'Content',
    links: [
      {
        label: 'Matches',
        href: '/admin/matches',
        icon: 'Swords',
        subLinks: [
          { label: 'Create Match', href: '/admin/matches', icon: 'CirclePlus', end: true },
          { label: 'Live Matches', href: '/admin/live-matches', icon: 'Clapperboard' },
          { label: 'Upcoming Matches', href: '/admin/upcoming-matches', icon: 'Video' },
          { label: 'Finished Matches', href: '/admin/finished-matches', icon: 'FileClock' },
        ],
      },
      { label: 'Streams', href: '/admin/streams', icon: 'Radio' },
      { label: 'Highlights', href: '/admin/highlights', icon: 'Film' },
      { label: 'Channels', href: '/admin/channels', icon: 'Tv' },
      { label: 'Events', href: '/admin/events', icon: 'LayoutList' },
      { label: 'Banner Manager', href: '/admin/banner-manager', icon: 'Palette' },
    ],
  },
  {
    title: 'Users',
    links: [
      { label: 'Users', href: '/admin/users', icon: 'Users' },
      { label: 'Roles', href: '/admin/roles', icon: 'Shield' },
      { label: 'Permissions', href: '/admin/permissions', icon: 'ShieldCheck' },
      { label: 'Premium Members', mobileLabel: 'Premium', href: '/admin/premium-users', icon: 'Star' },
      { label: 'Archived Users', href: '/admin/archived-users', icon: 'Archive' },
    ],
  },
  {
    title: 'Revenue',
    links: [
      { label: 'Subscription Plans', mobileLabel: 'Plans', href: '/admin/subscription-plans', icon: 'CreditCard' },
      { label: 'Payments', href: '/admin/payments', icon: 'Receipt' },
      { label: 'Manual Review', href: '/admin/manual-verification', icon: 'Check' },
    ],
  },
  {
    title: 'Engagement',
    links: [
      { label: 'Advertisements', href: '/admin/advertisements', icon: 'Monitor' },
      { label: 'Popups', href: '/admin/popup-manager', icon: 'PictureInPicture' },
      { label: 'Push Notifications', mobileLabel: 'Push', href: '/admin/push-notifications', icon: 'BellRing' },
      { label: 'Email Notifications', mobileLabel: 'Email', href: '/admin/email-notifications', icon: 'Mail' },
    ],
  },
  {
    title: 'System',
    links: [
      { label: 'Reports', href: '/admin/reports', icon: 'FileText' },
      {
        label: 'Logs',
        href: '/admin/logs',
        icon: 'FileText',
        subLinks: [
          { label: 'Audit Logs', href: '/admin/audit-logs', icon: 'FileClock' },
          { label: 'Activity Logs', href: '/admin/activity-logs', icon: 'Activity' },
          { label: 'System Logs', href: '/admin/system-logs', icon: 'FileClock' },
        ],
      },
      { label: 'Storage', href: '/admin/storage', icon: 'Cloud' },
    ],
  },
  {
    title: 'Site Settings',
    links: [
      { label: 'API Settings', href: '/admin/api-settings', icon: 'Code' },
      { label: 'Website Settings', mobileLabel: 'Website', href: '/admin/website-settings', icon: 'Globe' },
      { label: 'Settings', href: '/admin/settings', icon: 'Settings' },
      { label: 'Backup', href: '/admin/backup', icon: 'Archive' },
    ],
  },
];