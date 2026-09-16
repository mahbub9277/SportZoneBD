import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'

// A helper function to convert a URL path segment into a title-cased label.
// e.g., "user-management" -> "User Management"
const ROUTE_LABELS: Record<string, string> = {
  categories: 'Categories',
  channels: 'Channels',
  highlights: 'Highlights',
  matches: 'Matches',
  events: 'Events',
  standings: 'Standings',
  favorites: 'Favorites',
  notifications: 'Notifications',
  settings: 'Settings',
  subscriptions: 'Subscriptions',
  profile: 'Profile',
  watch: 'Watch',
}

const decodeSegment = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const toTitleCase = (value: string) => {
  const str = decodeSegment(value).replace(/-/g, ' ').replace(/_/g, ' ').trim()
  return str.replace(/\b\w/g, (char) => char.toUpperCase())
}

const getSegmentLabel = (value: string, index: number, segments: string[]) => {
  const normalized = decodeSegment(value).toLowerCase()
  if (ROUTE_LABELS[normalized]) return ROUTE_LABELS[normalized]

  // Keep opaque route identifiers readable without exposing long IDs in the UI.
  if (index > 0 && /^[a-f0-9-]{8,}$/i.test(value)) {
    return `${toTitleCase(segments[index - 1])} details`
  }

  return toTitleCase(value)
}

export function Breadcrumb() {
  const location = useLocation()
  const pathnames = location.pathname.split('/').filter(Boolean)

  // Don't render breadcrumbs on the home page
  if (pathnames.length === 0) {
    return null
  }

  const items = [
    { label: 'Home', href: '/' },
    ...pathnames.map((value, index) => {
      const href = `/${pathnames.slice(0, index + 1).join('/')}`
      const label = getSegmentLabel(value, index, pathnames)
      return { label, href }
    }),
  ]

  return (
    <nav aria-label="Breadcrumb" className="mb-2 min-w-0 overflow-x-auto scrollbar-none">
      <ol className="flex min-w-max items-center gap-1.5 text-xs text-(--text-muted) sm:gap-2 sm:text-sm">
        {items.map((item, index) => (
          <li key={item.href} className="flex items-center gap-1.5 sm:gap-2">
            {index > 0 && <ChevronRight size={14} className="shrink-0 text-(--text-muted)/60" aria-hidden="true" />}
          {index === items.length - 1 ? (
            <span className="max-w-48 truncate rounded-md bg-(--surface-soft)/70 px-2 py-1 font-semibold text-(--text-primary)" aria-current="page" title={item.label}>
              {item.label}
            </span>
          ) : (
            <Link to={item.href} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-(--surface-soft) hover:text-(--text-primary)">
              {index === 0 && <Home size={13} aria-hidden="true" />}
              {item.label}
            </Link>
          )}
          </li>
        ))}
      </ol>
    </nav>
  )
}