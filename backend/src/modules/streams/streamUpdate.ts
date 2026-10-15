import type { StreamStatus } from '@prisma/client'

export interface StreamRecordSnapshot {
  sourceType?: string | null
  channelId?: string | null
  primaryUrl?: string | null
  backupUrl?: string | null
  activationMode?: string | null
}

export interface StreamUpdatePayload {
  matchId?: string
  name?: string
  logo?: string | null
  primaryUrl?: string
  backupUrl?: string | null
  enabled?: boolean
  status?: StreamStatus
  quality?: string
  sourceType?: 'DIRECT_URL' | 'CHANNEL'
  channelId?: string | null
  activationMode?: 'AUTOMATIC' | 'MANUAL'
  activationOffsetMinutes?: number
}

/**
 * The `data` object for a partial stream update.
 *
 * A PATCH only ever changes what it names. Omitted properties stay absent from the `data` object, which is
 * what tells Prisma to leave the stored value alone — the previous implementation resolved `sourceType`,
 * `channelId`, `backupUrl` and `activationMode` to defaults on every request, so editing a name, a logo or
 * `enabled` silently unlinked the channel, dropped the backup source, switched the stream to DIRECT_URL and
 * reset a MANUAL activation. Explicitly supplied values (including an explicit `null`) are still applied.
 *
 * `primaryUrl` is only rewritten when the request provides one, or when it (re)establishes a channel link:
 * for a channel-sourced stream the channel is the authority, so the URL stored alongside the link is that
 * channel's current URL rather than a stale copy of a previous one.
 */
export function buildStreamUpdateData(
  existing: StreamRecordSnapshot,
  payload: StreamUpdatePayload,
  linkedChannelUrl: string | null,
): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  if (payload.matchId !== undefined) data.matchId = payload.matchId
  if (payload.name !== undefined) data.name = payload.name
  if (payload.logo !== undefined) data.logo = payload.logo
  if (payload.enabled !== undefined) data.enabled = payload.enabled
  if (payload.status !== undefined) data.status = payload.status
  if (payload.quality !== undefined) data.quality = payload.quality
  if (payload.activationOffsetMinutes !== undefined) data.activationOffsetMinutes = Number(payload.activationOffsetMinutes)

  // An omitted backup URL keeps the existing one; an explicit empty value clears it.
  if (payload.backupUrl !== undefined) data.backupUrl = payload.backupUrl?.trim() || null
  if (payload.activationMode !== undefined) data.activationMode = payload.activationMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC'

  const effectiveSourceType = payload.sourceType ?? (existing.sourceType === 'CHANNEL' ? 'CHANNEL' : 'DIRECT_URL')
  const effectiveChannelId = payload.channelId !== undefined ? payload.channelId ?? null : existing.channelId ?? null

  if (payload.sourceType !== undefined) data.sourceType = effectiveSourceType

  // The channel link is written only when the request changes it, or when the mode it switches to cannot
  // keep one. An untouched link is left out of `data` entirely so it survives any other edit.
  if (payload.channelId !== undefined) data.channelId = effectiveChannelId
  else if (payload.sourceType === 'DIRECT_URL' && existing.channelId) data.channelId = null

  // The caller only resolves a channel URL when this request names a channel to link to, which is when the
  // channel — not the copy previously stored — holds the URL this stream should play.
  if (linkedChannelUrl) data.primaryUrl = linkedChannelUrl
  else if (payload.primaryUrl !== undefined) data.primaryUrl = payload.primaryUrl.trim()

  return data
}
