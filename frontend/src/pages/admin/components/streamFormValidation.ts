import { z } from 'zod'
import type { Channel } from '../../../shared/types'
import { hasSupportedPlaybackProtocol } from '../../../utils/streamPlaybackUrl.ts'

/**
 * Validation for the stream form.
 *
 * A stream has two sources, and only one of them needs a URL from the administrator:
 *  - `DIRECT_URL` is played from the primary URL, so that URL is required and validated;
 *  - `CHANNEL` is played from the existing channel it links to, so the channel selection is what has to be
 *    valid and no separate primary URL is required. The stream record still stores that channel's URL
 *    (`Stream.primaryUrl` is a non-nullable column), which is the same URL the backend resolves for a
 *    channel-sourced stream — so nothing is blanked, invented or rewritten to a proxy path.
 *
 * The messages are exported so the form and its tests describe the contract once.
 */
export const STREAM_PRIMARY_URL_REQUIRED = 'Primary URL is required for direct streams.'
export const STREAM_PRIMARY_URL_INVALID = 'Please enter a valid URL.'
export const STREAM_PRIMARY_URL_PROTOCOL = 'Use an http:// or https:// stream URL'
export const STREAM_CHANNEL_REQUIRED = 'Select an existing channel to link this stream to.'
export const STREAM_CHANNEL_INVALID_ID = 'Invalid channel ID format.'
export const STREAM_CHANNEL_NOT_FOUND = 'The selected channel could not be found. Refresh the page and try again.'
export const STREAM_CHANNEL_URL_MISSING = 'The selected channel has no playback URL. Add one in Channel Management first.'

export type StreamSourceType = 'DIRECT_URL' | 'CHANNEL'

export interface StreamFormShape {
  sourceType: StreamSourceType
  channelId?: string
  name: string
  logo?: string
  primaryUrl: string
  backupUrl?: string
  matchId: string
  enabled: boolean
  quality: string
  status: 'READY' | 'LIVE' | 'OFFLINE' | 'ERROR'
}

/** A value the player can actually fetch: an absolute `http(s)` URL and nothing else. */
export function isPlayableStreamUrl(value: string | null | undefined): boolean {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return false
  return z.string().url().safeParse(trimmed).success && hasSupportedPlaybackProtocol(trimmed)
}

const optionalUrl = z.string().url('Logo must be a valid URL.').optional().or(z.literal(''))

/**
 * The form schema. It validates the shape only — whether the selected channel exists and has a URL is checked
 * when the form is submitted, because that needs the channel list the schema has no access to.
 *
 * `primaryUrl` stays a string in the form state (it is a text input) and its requirement is decided by the
 * source type below, so a channel stream can leave it empty.
 */
export const streamFormSchema = z
  .object({
    name: z.string().trim().min(2, 'Channel name is required.').max(80),
    logo: optionalUrl,
    primaryUrl: z.string().trim(),
    backupUrl: z
      .string()
      .url('Please enter a valid URL.')
      .refine(hasSupportedPlaybackProtocol, STREAM_PRIMARY_URL_PROTOCOL)
      .optional()
      .or(z.literal('')),
    matchId: z.string().min(1, 'You must select a match.').uuid('Invalid match ID format.'),
    enabled: z.boolean(),
    quality: z.string().min(1, 'Quality is required.'),
    status: z.enum(['READY', 'LIVE', 'OFFLINE', 'ERROR']),
    sourceType: z.enum(['DIRECT_URL', 'CHANNEL']),
    channelId: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    const primaryUrl = values.primaryUrl?.trim() ?? ''

    if (values.sourceType === 'CHANNEL') {
      if (!values.channelId?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['channelId'], message: STREAM_CHANNEL_REQUIRED })
      } else if (!z.string().uuid().safeParse(values.channelId.trim()).success) {
        ctx.addIssue({ code: 'custom', path: ['channelId'], message: STREAM_CHANNEL_INVALID_ID })
      }
      // No primary URL is required here: the linked channel supplies it. A typed one still has to be usable.
      if (primaryUrl && !isPlayableStreamUrl(primaryUrl)) {
        ctx.addIssue({ code: 'custom', path: ['primaryUrl'], message: STREAM_PRIMARY_URL_PROTOCOL })
      }
      return
    }

    if (!primaryUrl) {
      ctx.addIssue({ code: 'custom', path: ['primaryUrl'], message: STREAM_PRIMARY_URL_REQUIRED })
      return
    }
    if (!z.string().url().safeParse(primaryUrl).success) {
      ctx.addIssue({ code: 'custom', path: ['primaryUrl'], message: STREAM_PRIMARY_URL_INVALID })
      return
    }
    if (!hasSupportedPlaybackProtocol(primaryUrl)) {
      ctx.addIssue({ code: 'custom', path: ['primaryUrl'], message: STREAM_PRIMARY_URL_PROTOCOL })
    }
  })

/** The channel a channel-sourced stream will play from, or null when the selection cannot be used. */
export function findSelectedChannel(channels: readonly Channel[] | undefined, channelId?: string | null): Channel | null {
  const id = typeof channelId === 'string' ? channelId.trim() : ''
  if (!id) return null
  return channels?.find((channel) => channel.id === id) ?? null
}

/** The playback URL a channel already has, or null when it has none the player could fetch. */
export function resolveChannelPlaybackUrl(channel: Channel | null | undefined): string | null {
  const url = typeof channel?.url === 'string' ? channel.url.trim() : ''
  return isPlayableStreamUrl(url) ? url : null
}

export type StreamAssociationResult =
  | { ok: true; values: StreamFormShape }
  | { ok: false; field: 'channelId' | 'primaryUrl'; message: string }

/**
 * Resolves what the API should receive for this form state.
 *
 * A channel-sourced stream carries the selected channel's own URL as `primaryUrl`: the column is required, and
 * that URL is the one the player and the backend already resolve for such a stream. Nothing else about the
 * channel is written — selecting an existing channel only links it, it never creates or updates a Channel.
 */
export function resolveStreamAssociation(
  values: StreamFormShape,
  channels: readonly Channel[] | undefined,
): StreamAssociationResult {
  const base: StreamFormShape = {
    ...values,
    name: values.name.trim(),
    primaryUrl: values.primaryUrl?.trim() ?? '',
    backupUrl: values.backupUrl?.trim() ?? '',
  }

  if (values.sourceType !== 'CHANNEL') {
    return { ok: true, values: { ...base, channelId: undefined } }
  }

  const channelId = values.channelId?.trim() ?? ''
  if (!channelId) return { ok: false, field: 'channelId', message: STREAM_CHANNEL_REQUIRED }

  const channel = findSelectedChannel(channels, channelId)
  if (!channel) return { ok: false, field: 'channelId', message: STREAM_CHANNEL_NOT_FOUND }

  const channelUrl = resolveChannelPlaybackUrl(channel)
  if (!channelUrl) return { ok: false, field: 'channelId', message: STREAM_CHANNEL_URL_MISSING }

  return { ok: true, values: { ...base, channelId, primaryUrl: channelUrl } }
}
