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

/** Which of a stream's sources a URL is, so the proxy is asked for exactly that source. */
export type StreamSourceType = 'primary' | 'backup'

export interface StreamSource {
  url: string
  sourceType: StreamSourceType
}

/**
 * Every playable URL of a stream, each with the source the manifest proxy serves it from.
 *
 * The type matters: the proxy resolves `type=primary` and `type=backup` against the stream record's own
 * URLs, so a backup the UI selects has to travel as `backup` — otherwise the proxy would answer with the
 * primary the viewer just moved away from.
 */
export const getStreamSourceCandidates = (stream?: Partial<Stream> | null): StreamSource[] => {
  if (!stream) return []

  const candidates: Array<{ url: unknown; sourceType: StreamSourceType }> = [
    { url: stream.sourceType === 'CHANNEL' ? stream.channel?.url : undefined, sourceType: 'primary' },
    { url: stream.primaryUrl, sourceType: 'primary' },
    { url: stream.backupUrl, sourceType: 'backup' },
    { url: stream.url, sourceType: 'primary' },
    ...(Array.isArray(stream.backupUrls) ? stream.backupUrls.map((url) => ({ url, sourceType: 'backup' as const })) : []),
  ]

  const seen = new Set<string>()
  const sources: StreamSource[] = []
  for (const candidate of candidates) {
    if (!isValidStreamUrl(candidate.url)) continue
    const url = candidate.url.trim()
    // The first entry that names a URL wins, so a URL listed as both primary and backup is the primary.
    if (seen.has(url)) continue
    seen.add(url)
    sources.push({ url, sourceType: candidate.sourceType })
  }

  return sources
}

export const getStreamUrlCandidates = (stream?: Partial<Stream> | null): string[] =>
  getStreamSourceCandidates(stream).map((source) => source.url)

/** The source a stream starts on: its channel URL or primary URL, never a backup. */
export const getPreferredStreamSource = (stream?: Partial<Stream> | null): StreamSource | null =>
  getStreamSourceCandidates(stream)[0] ?? null

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
  /** Which source of that stream the URL is, so the proxy serves the same one the viewer was moved to. */
  sourceType: StreamSourceType
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

    for (const source of getStreamSourceCandidates(stream)) {
      if (seen.has(source.url)) continue
      seen.add(source.url)
      chain.push({ streamId: stream.id, streamName: stream.name ?? null, url: source.url, sourceType: source.sourceType })
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
  tournamentName?: string | null
  /** Season label exactly as the provider states it (e.g. "2026/2027"); absent when unknown. */
  season?: string | null;
  /** League round or matchday as a number; absent when nobody stated one. */
  round?: number | null;
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