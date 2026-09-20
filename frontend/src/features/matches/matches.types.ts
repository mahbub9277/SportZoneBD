export interface Team {
  id: string;
  name: string;
  logo: string | null;
}

export interface Stream {
  id: string;
  name?: string | null;
  logo?: string | null;
  quality?: string | null;
  primaryUrl?: string | null;
  backupUrl?: string | null;
  backupUrls?: string[] | null;
  url?: string | null;
  status?: string | null;
  sourceType?: 'DIRECT_URL' | 'CHANNEL' | string | null;
  channelId?: string | null;
  channel?: {
    id: string;
    name: string;
    url: string | null;
    logo?: string | null;
  } | null;
  activationMode?: 'AUTOMATIC' | 'MANUAL' | string | null;
  activationOffsetMinutes?: number | null;
  isPremium?: boolean;
  isEnabled?: boolean;
  enabled?: boolean;
}

const isValidStreamUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false

  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed !== 'null' && trimmed !== 'undefined'
}

export const getStreamUrlCandidates = (stream?: Partial<Stream> | null): string[] => {
  if (!stream) return []

  const urls = [
    stream.sourceType === 'CHANNEL' ? stream.channel?.url : undefined,
    stream.primaryUrl,
    stream.backupUrl,
    stream.url,
    ...(Array.isArray(stream.backupUrls) ? stream.backupUrls : []),
  ]

  return [...new Set(urls.filter(isValidStreamUrl).map((value) => value.trim()))]
}

export const isPlayableStream = (stream?: Partial<Stream> | null): boolean => {
  if (!stream) return false

  if (stream.enabled === false || stream.isEnabled === false) return false

  const status = typeof stream.status === 'string' ? stream.status.trim().toUpperCase() : ''
  if (['DISABLED', 'OFFLINE', 'ERROR'].includes(status)) return false

  return getStreamUrlCandidates(stream).length > 0
}

export const getPreferredStreamUrl = (stream?: Partial<Stream> | null): string | null => {
  const [preferredUrl] = getStreamUrlCandidates(stream)
  return preferredUrl ?? null
}

export interface Highlight {
  id: string;
  title: string;
  thumbnail: string | null;
  thumbnailUrl?: string | null;
  duration: string | null;
  url: string;
  category: string | null;
}

export interface Match {
  id: string;
  title: string;
  tournamentName?: string | null;
  kickoffAt: string; // ISO date string
  status: 'LIVE' | 'UPCOMING' | 'FINISHED';
  sport?: 'CRICKET' | 'FOOTBALL' | 'BASKETBALL' | 'TENNIS' | 'MOTORSPORTS' | 'WWE' | string;
  expectedEndTime?: string | null;
  autoFinish?: boolean;
  preStartEnabled?: boolean | null;
  preStartWindowMinutes?: number | null;
  preStartVideoUrl?: string | null;
  updatedAt?: string; // ISO date string, useful for 'finished' timestamp
  finishedAt?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeTeam?: TeamReference | null;
  awayTeam?: TeamReference | null;
  competition?: { id: string; name: string; logo?: string | null } | null;
  premium: boolean;
  streams: Stream[];
  highlights: Highlight[];
  [key: string]: unknown; // Keep for flexibility with other potential properties
}

export interface TeamReference {
  id: string;
  name: string;
  normalizedName?: string;
  logoUrl?: string | null;
  logoPublicId?: string | null;
}