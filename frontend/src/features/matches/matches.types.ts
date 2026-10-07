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

/** One playable URL of one stream, in the order the player may try it. */
export interface StreamCandidate {
  streamId: string
  streamName: string | null
  url: string
}

/**
 * The bounded candidate chain for a match: stream A primary → A backup → A backupUrls → stream B …,
 * in the order the streams are already displayed. Repeated URLs (the same source listed under several
 * streams, or a channel URL that is also a primary URL) appear once, so a failure can never bounce
 * between two entries pointing at the same broken source.
 */
export const getStreamCandidateChain = (streams?: ReadonlyArray<Partial<Stream>> | null): StreamCandidate[] => {
  if (!Array.isArray(streams)) return []

  const seen = new Set<string>()
  const chain: StreamCandidate[] = []

  for (const stream of streams) {
    if (!stream || typeof stream.id !== 'string' || !stream.id.trim()) continue
    if (!isPlayableStream(stream)) continue

    for (const url of getStreamUrlCandidates(stream)) {
      if (seen.has(url)) continue
      seen.add(url)
      chain.push({ streamId: stream.id, streamName: stream.name ?? null, url })
    }
  }

  return chain
}

/**
 * The candidate to use after `failedUrl` failed: the next entry that has not been attempted yet.
 * Returns null when the chain is exhausted, which is what makes automatic fallback bounded.
 */
export const findNextStreamCandidate = (
  chain: ReadonlyArray<StreamCandidate>,
  failedUrl: string | null | undefined,
  attempted: ReadonlySet<string>,
): StreamCandidate | null => {
  const index = typeof failedUrl === 'string' ? chain.findIndex((candidate) => candidate.url === failedUrl) : -1
  const remaining = index >= 0 ? chain.slice(index + 1) : chain
  return remaining.find((candidate) => !attempted.has(candidate.url)) ?? null
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