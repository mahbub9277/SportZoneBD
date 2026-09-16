export interface NavItem {
  label: string
  href: string
  icon?: string
}

export interface ChannelCategory {
  id: string
  name: string
  description?: string | null
  image?: string | null
  channels?: Channel[]
}

export interface Channel {
  id: string
  name: string
  logo?: string | null
  // Streaming URL may be omitted for premium-locked channels or when not available
  url?: string | null
  // Optional flag indicating premium-locked content
  isPremium?: boolean
  // Backend enum: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE'
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | string
  // Optional backlink to the category
  categoryId?: string | null
  category?: ChannelCategory | null
  // Timestamps in ISO format when available
  createdAt?: string
  updatedAt?: string
  // Optional admin-visible fields
  description?: string | null
  // Optional live viewer count for active streaming channels
  viewers?: number
  reactionCounts?: { like: number; dislike: number }
}
